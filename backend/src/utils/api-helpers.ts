/**
 * API Helper Utilities
 * Common helpers for API endpoints
 */

/**
 * Format a Server-Sent Events message.
 */
export function formatSSEMessage(event: string, data: Record<string, any>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Create a standardized error response.
 */
export function createErrorResponse(
  message: string,
  statusCode = 400,
  details?: any
): { error: { message: string; details?: any } } {
  const errorObj: { error: { message: string; details?: any } } = {
    error: { message },
  };

  if (details) {
    errorObj.error.details = details;
  }

  return errorObj;
}

/**
 * Map error messages to appropriate HTTP status codes.
 */
export function mapErrorToStatusCode(errorMessage: string): number {
  const errorLower = errorMessage.toLowerCase();

  if (errorLower.includes('not found')) {
    return 404;
  } else if (errorLower.includes('unauthorized') || errorLower.includes('forbidden')) {
    return 403;
  } else if (errorLower.includes('insufficient tokens') || errorLower.includes('payment')) {
    return 402; // Payment Required
  } else if (errorLower.includes('conflict') || errorLower.includes('already exists')) {
    return 409;
  } else {
    return 400;
  }
}

/**
 * Validate request parameters and throw descriptive errors
 */
export function validateRequiredFields(data: Record<string, any>, requiredFields: string[]): void {
  const missingFields = requiredFields.filter(
    (field) => data[field] === undefined || data[field] === null || data[field] === ''
  );

  if (missingFields.length > 0) {
    throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
  }
}

/**
 * Sanitize and validate slide count
 */
export function validateSlideCount(slideCount: any): number {
  const count = Number.parseInt(slideCount);

  if (isNaN(count) || count < 1 || count > 50) {
    throw new Error('Slide count must be between 1 and 50');
  }

  return count;
}

/**
 * Validate detail level parameter
 */
export function validateDetailLevel(detailLevel: string): string {
  const validLevels = ['brief', 'concise', 'balanced', 'detailed', 'comprehensive'];

  if (!validLevels.includes(detailLevel)) {
    throw new Error(`Invalid detail level. Must be one of: ${validLevels.join(', ')}`);
  }

  return detailLevel;
}

/**
 * Validate tonality parameter
 */
export function validateTonality(tonality: string): string {
  const validTonalities = ['professional', 'casual', 'enthusiastic', 'persuasive'];

  if (!validTonalities.includes(tonality)) {
    throw new Error(`Invalid tonality. Must be one of: ${validTonalities.join(', ')}`);
  }

  return tonality;
}

/**
 * Clean and validate topic string
 */
export function validateTopic(topic: string): string {
  if (!topic || typeof topic !== 'string') {
    throw new Error('Topic is required and must be a string');
  }

  const cleanTopic = topic.trim();

  if (cleanTopic.length < 1 || cleanTopic.length > 500) {
    throw new Error('Topic must be between 1 and 500 characters');
  }

  return cleanTopic;
}

/**
 * Extract user ID from JWT token (placeholder - implement based on your auth system)
 */
export function getCurrentUserId(authHeader?: string): number {
  // This is a placeholder implementation
  // In a real implementation, you would decode and validate the JWT token
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Invalid authorization header');
  }

  // For now, return a mock user ID
  // Replace this with actual JWT decoding logic
  return 1;
}

/**
 * Generate a unique presentation ID
 */
export function generatePresentationId(): string {
  return `pres_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Format presentation data for API response
 */
export function formatPresentationResponse(presentation: any): any {
  return {
    id: presentation.id,
    title: presentation.title,
    prompt: presentation.prompt,
    slides_data: presentation.slides_data,
    created_at: presentation.created_at,
    updated_at: presentation.updated_at,
    user_id: presentation.user_id,
  };
}

/**
 * Calculate estimated processing time based on slide count and complexity
 */
export function estimateProcessingTime(slideCount: number, detailLevel: string): number {
  const baseTimePerSlide = 2; // seconds

  const detailMultipliers: Record<string, number> = {
    brief: 0.7,
    concise: 0.9,
    balanced: 1.0,
    detailed: 1.5,
    comprehensive: 2.0,
  };

  const multiplier = detailMultipliers[detailLevel] || 1.0;
  return Math.ceil(slideCount * baseTimePerSlide * multiplier);
}
