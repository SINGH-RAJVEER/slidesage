/**
 * Presentation Service
 * Handles presentation generation with token management and streaming
 */

import type { Presentation } from '../db/schema';
import { PresentationRepository } from '../repositories/presentation.repository';
import { UserRepository } from '../repositories/user.repository';
import type { PresentationStreamEvent, Slide } from '../types';
import { AIService } from './ai.service';
import { TokenCalculator } from './token-calculator';

export interface GeneratePresentationParams {
  userId: string;
  topic: string;
  slideCount: number;
  detailLevel?: string;
  tonality?: string;
}

export interface IteratePresentationParams {
  userId: string;
  presentationId: string;
  feedback: string;
  detailLevel?: string;
  tonality?: string;
}

export class PresentationService {
  private aiService: AIService;
  private userRepo = UserRepository;
  private presentationRepo = new PresentationRepository();

  constructor() {
    this.aiService = new AIService();
  }

  /**
   * Calculate estimated tokens for presentation generation
   */
  calculateEstimatedTokens(
    slideCount: number,
    detailLevel = 'balanced',
    tonality = 'professional'
  ): number {
    const estimate = TokenCalculator.calculateEstimatedTokens({
      slideCount,
      detailLevel,
      tonality,
    });
    return estimate.estimatedTokens;
  }

  /**
   * Generate presentation with token management and streaming
   */
  async *generatePresentationStream(
    params: GeneratePresentationParams
  ): AsyncGenerator<PresentationStreamEvent, void, unknown> {
    const {
      userId,
      topic,
      slideCount,
      detailLevel = 'balanced',
      tonality = 'professional',
    } = params;

    try {
      // Verify user exists and has enough tokens
      const estimatedTokens = this.calculateEstimatedTokens(slideCount, detailLevel, tonality);
      const tokenCheck = await this.userRepo.hasSufficientTokens(userId, estimatedTokens);

      if (!tokenCheck.sufficient) {
        yield {
          event: 'error',
          data: {
            error: 'Insufficient tokens',
            details: {
              required: estimatedTokens,
              available: tokenCheck.user.slideTokens,
              shortfall: tokenCheck.shortfall,
            },
          },
        };
        return;
      }

      // Deduct tokens upfront (will be skipped for unlimited users)
      await this.userRepo.deductTokens(userId, estimatedTokens);
      console.log(`Deducted ${estimatedTokens} tokens from user ${userId}`);

      let actualTokensUsed = 0;
      let generationSuccessful = false;

      try {
        // Stream presentation generation
        for await (const event of this.aiService.generatePresentationStream(
          topic,
          slideCount,
          detailLevel,
          tonality
        )) {
          yield event;

          if (event.event === 'complete') {
            actualTokensUsed = event.data.tokens_used || 0;
            generationSuccessful = true;
          } else if (event.event === 'error') {
            // Generation failed, will refund tokens
            break;
          }
        }

        // Handle token refund if generation failed or used fewer tokens than estimated
        if (!generationSuccessful || actualTokensUsed < estimatedTokens * 1000) {
          const refundUser = await this.userRepo.refundTokens(
            userId,
            estimatedTokens,
            actualTokensUsed
          );
          console.log(`Refunded tokens to user ${userId}, new balance: ${refundUser.slideTokens}`);
        }
      } catch (error) {
        // Refund tokens on any error
        await this.userRepo.refundTokens(userId, estimatedTokens, actualTokensUsed);
        console.error('Error during generation, tokens refunded:', error);
        throw error;
      }
    } catch (error) {
      console.error('Error in presentation generation:', error);
      yield {
        event: 'error',
        data: { error: `Generation failed: ${error}` },
      };
    }
  }

  /**
   * Iterate on existing presentation with feedback
   */
  async *iteratePresentationStream(
    params: IteratePresentationParams
  ): AsyncGenerator<PresentationStreamEvent, void, unknown> {
    const {
      userId,
      presentationId,
      feedback,
      detailLevel = 'balanced',
      tonality = 'professional',
    } = params;

    try {
      // Get the existing presentation
      const existingPresentation = await this.presentationRepo.findById(presentationId);

      if (!existingPresentation) {
        yield {
          event: 'error',
          data: { error: 'Presentation not found' },
        };
        return;
      }

      // Verify user owns the presentation
      if (existingPresentation.userId !== userId) {
        yield {
          event: 'error',
          data: { error: 'Unauthorized access to presentation' },
        };
        return;
      }

      // slidesData is stored as JSON; cast for safe access.
      const currentSlides =
        (existingPresentation.slidesData as unknown as { slides?: Slide[] })?.slides || [];

      // Calculate tokens for iteration (typically less than full generation)
      const estimatedTokens =
        this.calculateEstimatedTokens(currentSlides.length, detailLevel, tonality) * 0.7; // 30% discount for iterations

      // Check token sufficiency
      const tokenCheck = await this.userRepo.hasSufficientTokens(userId, estimatedTokens);

      if (!tokenCheck.sufficient) {
        yield {
          event: 'error',
          data: {
            error: 'Insufficient tokens for iteration',
            details: {
              required: estimatedTokens,
              available: tokenCheck.user.slideTokens,
              shortfall: tokenCheck.shortfall,
            },
          },
        };
        return;
      }

      // Deduct tokens upfront
      await this.userRepo.deductTokens(userId, estimatedTokens);
      console.log(`Deducted ${estimatedTokens} tokens from user ${userId} for iteration`);

      let actualTokensUsed = 0;
      let iterationSuccessful = false;

      try {
        // Stream presentation iteration
        for await (const event of this.aiService.iteratePresentationStream(
          currentSlides,
          feedback,
          detailLevel,
          tonality
        )) {
          yield event;

          if (event.event === 'complete') {
            actualTokensUsed = event.data.tokens_used || 0;
            iterationSuccessful = true;
          } else if (event.event === 'error') {
            // Iteration failed, will refund tokens
            break;
          }
        }

        // Handle token refund if iteration failed or used fewer tokens than estimated
        if (!iterationSuccessful || actualTokensUsed < estimatedTokens * 1000) {
          const refundUser = await this.userRepo.refundTokens(
            userId,
            estimatedTokens,
            actualTokensUsed
          );
          console.log(
            `Refunded iteration tokens to user ${userId}, new balance: ${refundUser.slideTokens}`
          );
        }

        // Persistence is handled by the HTTP route layer.
      } catch (error) {
        // Refund tokens on any error
        await this.userRepo.refundTokens(userId, estimatedTokens, actualTokensUsed);
        console.error('Error during iteration, tokens refunded:', error);
        throw error;
      }
    } catch (error) {
      console.error('Error in presentation iteration:', error);
      yield {
        event: 'error',
        data: { error: `Iteration failed: ${error}` },
      };
    }
  }

  /**
   * Get user presentations with pagination
   */
  async getUserPresentations(
    userId: string,
    limit = 20,
    offset = 0
  ): Promise<{
    presentations: Presentation[];
    total: number;
    hasMore: boolean;
  }> {
    return await this.presentationRepo.findByUserId(userId, limit, offset);
  }

  /**
   * Get presentation by ID with ownership check
   */
  async getPresentation(presentationId: string, userId: string): Promise<Presentation> {
    const presentation = await this.presentationRepo.findById(presentationId);

    if (!presentation) {
      throw new Error('Presentation not found');
    }

    if (presentation.userId !== userId) {
      throw new Error('Unauthorized access to presentation');
    }

    return presentation;
  }

  /**
   * Delete presentation with ownership check
   */
  async deletePresentation(presentationId: string, userId: string): Promise<void> {
    const presentation = await this.presentationRepo.findById(presentationId);

    if (!presentation) {
      throw new Error('Presentation not found');
    }

    if (presentation.userId !== userId) {
      throw new Error('Unauthorized access to presentation');
    }

    await this.presentationRepo.delete(presentationId);
  }

  /**
   * Get presentation iterations/versions
   */
  async getPresentationIterations(presentationId: string, userId: string): Promise<Presentation[]> {
    await this.getPresentation(presentationId, userId);
    return await this.presentationRepo.findIterations(presentationId);
  }

  /**
   * Get token pricing information
   */
  getTokenPricing(): Record<string, unknown> {
    return {
      tiers: TokenCalculator.getTokenPricingTiers(),
      dailyBonus: TokenCalculator.getDailyLoginBonus(),
      detailLevels: ['brief', 'concise', 'balanced', 'detailed', 'comprehensive'].map((level) =>
        TokenCalculator.getDetailLevelInfo(level)
      ),
      tonalities: ['casual', 'professional', 'enthusiastic', 'persuasive'].map((tonality) =>
        TokenCalculator.getTonalityInfo(tonality)
      ),
    };
  }
}
