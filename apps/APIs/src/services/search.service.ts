import type { ResearchOptions, Source } from '@slide-sage/contracts';
import { TokenCalculator } from './token-calculator';

export interface SearchSummaryResult {
  summary: string | null;
  tokensUsed: number;
  tokensEstimated: number;
}

interface BraveWebSearchResult {
  url?: string;
  title?: string;
  description?: string;
}

interface BraveWebSearchResponse {
  web?: {
    results?: BraveWebSearchResult[];
  };
}

export class SearchService {
  async webSearch(query: string, options: ResearchOptions): Promise<Source[]> {
    if (!options.enabled) return [];

    const apiKey = process.env.BRAVE_SEARCH_API_KEY;
    if (!apiKey) {
      console.warn('Web research enabled but BRAVE_SEARCH_API_KEY is not set; skipping search.');
      return [];
    }

    const normalizedQuery = this.normalizeQuery(query);
    if (!normalizedQuery) return [];

    const maxResults = this.clampNumber(options.maxResults ?? 5, 1, 10);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);

    try {
      const url = new URL('https://api.search.brave.com/res/v1/web/search');
      url.searchParams.set('q', normalizedQuery);
      url.searchParams.set('count', String(maxResults));
      url.searchParams.set('safesearch', 'moderate');

      if (options.freshness) {
        url.searchParams.set('freshness', options.freshness);
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': apiKey,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        console.warn(`Brave Search failed: ${response.status} ${response.statusText}`, body);
        return [];
      }

      const data = (await response.json()) as BraveWebSearchResponse;
      const results = Array.isArray(data.web?.results) ? data.web?.results : [];

      const retrievedAt = new Date().toISOString();

      const sources: Source[] = [];
      for (const r of results) {
        const urlValue = typeof r.url === 'string' ? r.url.trim() : '';
        if (!urlValue || !this.isLikelyHttpUrl(urlValue)) continue;

        sources.push({
          url: urlValue,
          title: typeof r.title === 'string' ? r.title.trim() : undefined,
          snippet: typeof r.description === 'string' ? r.description.trim() : undefined,
          retrieved_at: retrievedAt,
        });
      }

      return sources;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn('Brave Search request timed out');
        return [];
      }
      console.warn('Brave Search request failed:', error);
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  async summarizeSourcesDetailed(query: string, sources: Source[]): Promise<SearchSummaryResult> {
    if (!sources.length) {
      return { summary: null, tokensUsed: 0, tokensEstimated: 0 };
    }

    const apiKey = process.env.GROQ_API_KEY || '';
    const model = process.env.LITELLM_SEARCH_MODEL || 'llama-3.1-8b-instant';
    const apiBase =
      process.env.GROQ_SEARCH_API_BASE || 'https://api.groq.com/openai/v1/chat/completions';

    if (!apiKey) {
      console.warn('GROQ_API_KEY is not set; skipping search summarization.');
      return { summary: null, tokensUsed: 0, tokensEstimated: 0 };
    }

    const trimmedQuery = this.normalizeQuery(query);
    const compactSources = sources.slice(0, 8).map((source) => ({
      url: source.url,
      title: source.title,
      snippet: source.snippet,
      retrieved_at: source.retrieved_at,
    }));

    const systemPrompt =
      "You are a research summarizer. Produce a compact, factual summary of the provided web results for the user's topic. Keep it concise and actionable. Use 4-7 bullet points max. Do not invent facts. If sources are thin, say so.";

    const userPrompt = `User topic: ${trimmedQuery || '(not provided)'}

Sources (JSON):
${JSON.stringify(compactSources, null, 2)}`;

    const promptTokensEstimated = TokenCalculator.estimateTokensForChatMessages([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);

    // If the provider doesn't return usage, approximate completion tokens.
    // This should align with the max_tokens in the request.
    const completionTokensEstimated = Math.floor(500 * 0.6);
    const tokensEstimated = promptTokensEstimated + Math.max(0, completionTokensEstimated);

    try {
      const response = await fetch(apiBase, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: 500,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        console.warn(
          `Groq summary request failed: ${response.status} ${response.statusText}`,
          body
        );
        return { summary: null, tokensUsed: 0, tokensEstimated };
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { total_tokens?: number };
      };

      const content = data.choices?.[0]?.message?.content;
      const summary = typeof content === 'string' ? content.trim() : '';

      const tokensUsed =
        typeof data.usage?.total_tokens === 'number' && Number.isFinite(data.usage.total_tokens)
          ? data.usage.total_tokens
          : 0;

      return {
        summary: summary || null,
        tokensUsed,
        tokensEstimated,
      };
    } catch (error) {
      console.warn('Groq summary request failed:', error);
      return { summary: null, tokensUsed: 0, tokensEstimated };
    }
  }

  async summarizeSources(query: string, sources: Source[]): Promise<string | null> {
    const result = await this.summarizeSourcesDetailed(query, sources);
    return result.summary;
  }

  private normalizeQuery(query: string): string {
    const q = String(query ?? '').trim();
    if (!q) return '';
    return q.length > 400 ? q.slice(0, 400) : q;
  }

  private clampNumber(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, Math.floor(value)));
  }

  private isLikelyHttpUrl(value: string): boolean {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  }
}
