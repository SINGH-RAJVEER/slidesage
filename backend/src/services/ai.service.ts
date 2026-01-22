import type { LiteLLMMessage, PresentationStreamEvent, Slide } from '../types';
import { StreamProcessor } from '../utils/stream-processor';
import { buildGenerationPrompt } from './ai-prompts';

// Using dynamic import for litellm compatibility
const completion: unknown = null;

async function initLiteLLM() {
  if (!completion) {
    try {
      // LiteLLM is available via Python subprocess or API
      // For now, we'll use a simple fetch-based approach to an OpenAI-compatible endpoint
      console.log('AI Service initialized');
    } catch (error) {
      console.warn('LiteLLM SDK not available:', error);
    }
  }
}

export class AIService {
  constructor() {
    initLiteLLM();
  }

  private processSlide(slide: Slide, index: number): Slide | null {
    if (!slide || typeof slide !== 'object') {
      console.warn(`Invalid slide ${index}, skipping`);
      return null;
    }

    slide.id = slide.id || `slide-${index + 1}`;
    slide.type = slide.type || 'content';

    if (slide.type === 'chart' && !slide.chartConfig) {
      console.warn(`Chart slide ${index} missing chartConfig, converting to content`);
      slide.type = 'content';
      slide.html =
        '<div id="slide-content"><h2 id="slide-title">Data Visualization</h2><p id="slide-description">Chart data unavailable</p></div>';
    } else if (slide.html) {
      const htmlContent = slide.html.trim();
      if (!htmlContent.startsWith('<div id="slide-content">')) {
        slide.html = `<div id="slide-content">${htmlContent}</div>`;
        console.log(`Added slide-content wrapper to slide ${index}`);
      }
    }

    return slide;
  }

  async *generatePresentationStream(
    userPrompt: string,
    slideCount = 8,
    detailLevel = 'balanced',
    tonality = 'professional'
  ): AsyncGenerator<PresentationStreamEvent, void, unknown> {
    console.log(
      `Starting generate presentation for: ${userPrompt.substring(0, 50)}... with ${slideCount} slides`
    );

    try {
      const systemPrompt = buildGenerationPrompt(detailLevel, tonality);

      const messages = [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Create a comprehensive presentation with data visualizations about: ${userPrompt} in ${slideCount} slides.`,
        },
      ];

      const model = process.env.LITELLM_MODEL || 'openai/gpt-4';

      // Call LiteLLM API via Bun's fetch
      const response = await this.callLiteLLMStreaming(model, messages);

      const processor = new StreamProcessor();

      // Yield initial event
      yield { event: 'start', data: { status: 'generating' } };

      let chunkCount = 0;

      // Process streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body');
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              chunkCount++;

              const chunkContent = processor.processChunk(parsed);
              if (chunkContent) {
                processor.accumulateContent(chunkContent);
              }

              // Extract and yield theme if not yet yielded
              if (!processor.themeYielded) {
                const theme = processor.extractTheme();
                if (theme) {
                  yield { event: 'theme', data: { theme } };
                }
              }

              // Extract and yield any new complete slides
              const newSlides = processor.extractSlides();
              for (const [idx, slide] of newSlides) {
                const processedSlide = this.processSlide(slide, idx);
                if (processedSlide) {
                  // Extract title from first slide
                  if (idx === 0 && processor.titleExtracted === null) {
                    processor.titleExtracted = processor.extractTitleFromSlide(slide);
                  }

                  yield {
                    event: 'slide',
                    data: {
                      slide: processedSlide,
                      index: idx,
                      title: processor.titleExtracted,
                    },
                  };
                }
              }
            } catch (error) {
              // Skip invalid JSON chunks
            }
          }
        }
      }

      // Final processing
      console.log(`Streaming complete. Total chunks: ${chunkCount}`);

      const cleanContent = processor.getCleanContent();
      if (!cleanContent) {
        console.error('No content received from AI model!');
        yield {
          event: 'error',
          data: {
            error:
              'No response received from AI model. Check your API key and model configuration.',
          },
        };
        return;
      }

      try {
        const parsedContent = JSON.parse(cleanContent);
        console.log(
          `Successfully parsed JSON response with ${parsedContent.slides?.length || 0} slides`
        );

        // Process any remaining slides
        if (parsedContent.slides) {
          for (let idx = processor.slidesYielded; idx < parsedContent.slides.length; idx++) {
            const slide = parsedContent.slides[idx];
            const processedSlide = this.processSlide(slide, idx);
            if (processedSlide) {
              processor.slidesYielded++;
              yield {
                event: 'slide',
                data: {
                  slide: processedSlide,
                  index: idx,
                  title: processor.titleExtracted,
                },
              };
            }
          }
        }

        // Add metadata
        parsedContent.title =
          processor.titleExtracted || parsedContent.title || 'Untitled Presentation';
        if (parsedContent.slides) {
          parsedContent.totalSlides = parsedContent.slides.length;
        }
        parsedContent.tokens_used = processor.totalTokensUsed;

        console.log(`Generation completed. Total tokens used: ${processor.totalTokensUsed}`);

        // Yield completion event
        yield {
          event: 'complete',
          data: parsedContent,
        };
      } catch (error) {
        console.error('JSON parsing error:', error);
        yield {
          event: 'error',
          data: { error: 'Failed to parse AI response' },
        };
      }
    } catch (error) {
      console.error('Error during generation:', error);
      yield {
        event: 'error',
        data: { error: `An error occurred: ${error}` },
      };
    }
  }

  private async callLiteLLMStreaming(model: string, messages: LiteLLMMessage[]): Promise<Response> {
    // Use OpenAI-compatible API endpoint
    const apiEndpoint =
      process.env.LITELLM_API_BASE || 'https://api.openai.com/v1/chat/completions';
    const apiKey = process.env.OPENAI_API_KEY || process.env.LITELLM_API_KEY;

    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model.includes('/') ? model.split('/')[1] : model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
      }),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    return response;
  }
}
