// AI Service Prompts and Configuration

const DETAIL_LEVEL_GUIDE: Record<string, { description: string; example: string }> = {
  brief: {
    description:
      'Brief - Minimal content with key highlights only. Focus on visual impact and headlines.',
    example:
      'Use 2-3 short bullet points (3-5 words). Avoid full sentences. Focus on keywords and metrics.',
  },
  concise: {
    description:
      'Concise - Essential information in compact form. Ideal for standard presentations.',
    example: 'Use 3-4 bullet points (5-10 words). Short, punchy phrases. Clear and direct.',
  },
  balanced: {
    description:
      'Balanced - Standard level of detail with clear explanations. Good for informative decks.',
    example:
      'Use 4-5 bullet points (10-15 words). Complete thoughts but not paragraphs. Mix of text and data.',
  },
  detailed: {
    description:
      'Detailed - Comprehensive information with elaboration. Suitable for technical or academic topics.',
    example:
      'Use 5-6 bullet points (15-25 words). Full sentences with supporting details. Thorough explanations.',
  },
  comprehensive: {
    description:
      'Comprehensive - In-depth coverage with extensive details. For reading decks or documentation.',
    example:
      'Use 6+ bullet points or paragraphs. Extensive text (25+ words). Deep analysis, context, and footnotes.',
  },
};

const TONALITY_GUIDE: Record<string, { description: string; example: string }> = {
  professional: {
    description:
      'Professional - Business-appropriate, objective, and polished. Trustworthy and authoritative.',
    example:
      'Use formal language, industry terminology, and data-driven statements. Avoid slang or casual idioms.',
  },
  casual: {
    description: 'Casual - Relaxed, conversational, and approachable. Friendly and relatable.',
    example:
      'Use everyday language, contractions ("we\'re", "it\'s"), and a warm tone. Speak directly to the audience.',
  },
  enthusiastic: {
    description:
      'Enthusiastic - Energetic, passionate, and motivational. High energy and inspiring.',
    example:
      'Use dynamic verbs, positive adjectives ("amazing", "incredible"), and exclamation points. Focus on potential and excitement.',
  },
  persuasive: {
    description:
      'Persuasive - Compelling, benefit-focused, and action-oriented. Designed to convert.',
    example:
      'Use strong calls-to-action, rhetorical questions, and benefit-driven language. Focus on the "why" and the value proposition.',
  },
};

export function buildGenerationPrompt(detailLevel = 'balanced', tonality = 'professional'): string {
  const detailConfig = DETAIL_LEVEL_GUIDE[detailLevel] || DETAIL_LEVEL_GUIDE.balanced;
  const tonalityConfig = TONALITY_GUIDE[tonality] || TONALITY_GUIDE.professional;

  return `You are an expert presentation designer. Create comprehensive presentations with structured HTML, standardized IDs, data tables, and appropriate content.

IMPORTANT: Analyze the content depth and create the APPROPRIATE number of slides (as many slides as requested by the user).

CRITICAL JSON FORMATTING RULES:
1. The response MUST be a single, valid JSON object
2. NO additional text, markdown, or code blocks before or after the JSON
3. NO comments within the JSON
4. ALL strings must be properly escaped and enclosed in double quotes
5. NO trailing commas
6. NO single quotes for strings
7. ALL HTML content must be properly escaped within the JSON strings

CRITICAL HTML STRUCTURE REQUIREMENTS:
- EVERY slide's HTML content MUST start with <div id="slide-content">
- ALL content must be wrapped inside the slide-content div
- This wrapper is essential for template styling to work properly
- Never generate HTML without the slide-content wrapper

DETAIL LEVEL: ${detailConfig.description}
Example: ${detailConfig.example}

TONALITY: ${tonalityConfig.description}
Example: ${tonalityConfig.example}

Response must be valid JSON with this structure:
{
  "title": "Presentation Title",
  "theme": "professional/creative/minimal/corporate",
  "slides": [
    {
      "id": "slide-1",
      "type": "title/content/chart",
      "html": "<div id=\\"slide-content\\">...</div>"
    }
  ]
}`;
}

import type { Slide } from '../types';

export function buildIterationPrompt(currentSlides: Slide[], feedback: string): string {
  return `You are editing an existing presentation. Apply the following changes: ${feedback}

Current presentation structure:
${JSON.stringify(currentSlides, null, 2)}

Respond with the complete updated presentation in the same JSON format.`;
}
