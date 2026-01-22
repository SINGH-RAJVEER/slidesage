// Stream Processing Utilities

interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
    };
  }>;
  usage?: {
    total_tokens?: number;
  };
}

export class StreamProcessor {
  accumulatedContent = '';
  slidesYielded = 0;
  themeYielded = false;
  titleExtracted: string | null = null;
  totalTokensUsed = 0;
  chunkCount = 0;

  processChunk(chunk: any): string {
    this.chunkCount++;
    let chunkContent = '';

    // Extract content from chunk
    if (chunk?.choices?.[0]?.delta?.content) {
      chunkContent = chunk.choices[0].delta.content;
    }

    // Extract usage from final chunk
    if (chunk?.usage?.total_tokens) {
      this.totalTokensUsed = chunk.usage.total_tokens;
      console.log(`Token usage detected: ${this.totalTokensUsed}`);
    }

    return chunkContent;
  }

  accumulateContent(chunkContent: string): void {
    this.accumulatedContent += chunkContent;
  }

  getCleanContent(): string {
    let clean = this.accumulatedContent.trim();
    if (clean.startsWith('```json')) {
      clean = clean
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();
    } else if (clean.startsWith('```')) {
      clean = clean.replace(/```/g, '').trim();
    }
    return clean;
  }

  extractTheme(): string | null {
    if (this.themeYielded) return null;

    const clean = this.getCleanContent();
    const themeMatch = clean.match(/"theme"\s*:\s*"([^"]*)"/);
    if (themeMatch) {
      this.themeYielded = true;
      return themeMatch[1];
    }
    return null;
  }

  extractSlides(): Array<[number, any]> {
    const clean = this.getCleanContent();
    const newSlides: Array<[number, any]> = [];

    try {
      // Try to find complete slide objects
      const slidesMatch = clean.match(/"slides"\s*:\s*\[(.*)\]/s);
      if (!slidesMatch) return newSlides;

      const slidesContent = slidesMatch[1];
      const slideObjects = this.parseSlideObjects(slidesContent);

      // Return only new slides that haven't been yielded yet
      for (let i = this.slidesYielded; i < slideObjects.length; i++) {
        newSlides.push([i, slideObjects[i]]);
        this.slidesYielded++;
      }
    } catch (error) {
      // Parsing failed, no new slides to yield
    }

    return newSlides;
  }

  private parseSlideObjects(content: string): any[] {
    const slides: any[] = [];
    let depth = 0;
    let currentSlide = '';
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];

      if (escapeNext) {
        currentSlide += char;
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        currentSlide += char;
        continue;
      }

      if (char === '"') {
        inString = !inString;
      }

      if (!inString) {
        if (char === '{') depth++;
        if (char === '}') depth--;
      }

      currentSlide += char;

      if (!inString && depth === 0 && char === '}') {
        try {
          const slide = JSON.parse(currentSlide.trim());
          slides.push(slide);
          currentSlide = '';
        } catch (error) {
          // Failed to parse, keep accumulating
        }
      }
    }

    return slides;
  }

  extractTitleFromSlide(slide: any): string | null {
    if (!slide?.html) return null;

    // Extract title from HTML
    const titleMatch = slide.html.match(/<h[12][^>]*id="slide-title"[^>]*>(.*?)<\/h[12]>/i);
    if (titleMatch) {
      return titleMatch[1].replace(/<[^>]*>/g, '').trim();
    }

    return null;
  }
}
