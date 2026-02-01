/*
 * JSON Recovery Utilities
 * Handles malformed JSON recovery for AI-generated responses
 */

export class JSONRecoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JSONRecoveryError';
  }
}

export interface RecoveryResult {
  content: any;
  recovered: boolean;
  strategy?: string;
}

/*
 * Attempt to recover valid JSON from malformed content.
 *
 * Strategies:
 * 1. Truncate at error position and close structures properly
 * 2. Balance unclosed brackets and braces
 *
 * @param content - The malformed JSON string
 * @param error - The JSONError that was raised
 * @returns Recovered JSON as an object
 * @throws JSONRecoveryError if recovery fails
 */
export function recoverJson(content: string, error: Error): RecoveryResult {
  console.error('JSON parsing error:', error.message);
  console.error(`Content length: ${content.length}, First 500 chars:`, content.slice(0, 500));

  // Try to extract error position from different error types
  let errorPos = 0;
  if ('position' in error) {
    errorPos = (error as any).position;
  } else if (error.message.includes('position')) {
    const match = error.message.match(/position (\d+)/);
    if (match) {
      errorPos = Number.parseInt(match[1]);
    }
  }

  console.error(`Error position: ${errorPos}`);

  // Show context around the error
  const errorStart = Math.max(0, errorPos - 100);
  const errorEnd = Math.min(content.length, errorPos + 100);
  console.error(`Error context: ...${content.slice(errorStart, errorEnd)}...`);

  // Strategy 1: Try to truncate at the error position and close properly
  try {
    const fixedContent = truncateAndClose(content, errorPos);
    const parsedContent = JSON.parse(fixedContent);
    console.info(
      `Successfully parsed truncated JSON with ${parsedContent.slides?.length || 0} slides`
    );
    return {
      content: parsedContent,
      recovered: true,
      strategy: 'truncate',
    };
  } catch (truncateError) {
    console.warn('Truncation strategy failed, trying brace balancing');
  }

  // Strategy 2: Just try to balance braces
  try {
    const fixedContent = balanceBraces(content);
    const parsedContent = JSON.parse(fixedContent);
    console.info(`Successfully parsed fixed JSON with ${parsedContent.slides?.length || 0} slides`);
    return {
      content: parsedContent,
      recovered: true,
      strategy: 'balance',
    };
  } catch (balanceError) {
    console.error('Could not recover from JSON error:', balanceError);
    saveMalformedJson(content);
    throw new JSONRecoveryError(`All recovery strategies failed: ${balanceError}`);
  }
}

/**
 * Truncate content at the last valid slide before the error position.
 */
function truncateAndClose(content: string, errorPos: number): string {
  const contentBeforeError = content.slice(0, errorPos);

  // Find the last complete slide object by counting braces
  let lastValidPos = 0;
  let braceCount = 0;
  let bracketCount = 0;
  let inString = false;
  let escapeNext = false;
  let inSlidesArray = false;

  for (let i = 0; i < contentBeforeError.length; i++) {
    const char = contentBeforeError[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '{') {
        braceCount++;
      } else if (char === '}') {
        braceCount--;
        // Track when we complete a slide object (back to slides array level)
        if (inSlidesArray && braceCount === 2) {
          // 1 for root object + 1 for slides array
          lastValidPos = i + 1;
        }
      } else if (char === '[') {
        bracketCount++;
        // Check if this is the slides array
        if (i > 10 && contentBeforeError.slice(Math.max(0, i - 10), i).includes('"slides"')) {
          inSlidesArray = true;
        }
      } else if (char === ']') {
        bracketCount--;
      }
    }
  }

  if (lastValidPos > 0) {
    console.info(`Found last valid position at ${lastValidPos}`);
    let fixedContent = contentBeforeError.slice(0, lastValidPos);

    // Close the slides array and main object
    fixedContent += '],"totalSlides":';
    // Count how many complete slides we have
    const slideCount = (fixedContent.match(/"id":"slide-/g) || []).length;
    fixedContent += slideCount + '}';

    console.info('Attempting to parse truncated JSON...');
    return fixedContent;
  } else {
    throw new Error('Could not find valid truncation point');
  }
}

/*
 * Balance unclosed brackets and braces in the content.
 */
function balanceBraces(content: string): string {
  const bracketBalance = (content.match(/\[/g) || []).length - (content.match(/\]/g) || []).length;
  const braceBalance = (content.match(/\{/g) || []).length - (content.match(/\}/g) || []).length;

  console.info(
    `JSON balance: ${bracketBalance} unclosed brackets, ${braceBalance} unclosed braces`
  );

  // Attempt to complete the JSON
  let fixedContent = content;
  if (bracketBalance > 0) {
    fixedContent += ']'.repeat(bracketBalance);
  }
  if (braceBalance > 0) {
    fixedContent += '}'.repeat(braceBalance);
  }

  console.info('Attempting to parse fixed JSON...');
  return fixedContent;
}

/*
 * Save malformed JSON to a temp file for debugging
 */
function saveMalformedJson(content: string): void {
  try {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    const tempFile = path.join(os.tmpdir(), `litellm_error_${Date.now()}.json`);
    fs.writeFileSync(tempFile, content);
    console.error(`Saved malformed JSON to: ${tempFile}`);
  } catch (e) {
    console.warn('Could not save malformed JSON:', e);
  }
}
