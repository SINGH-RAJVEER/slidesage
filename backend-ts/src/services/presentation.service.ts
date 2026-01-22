import type { Presentation } from "../db/schema";
import { PresentationRepository } from "../repositories/presentation.repository";
import { UserRepository } from "../repositories/user.repository";
import { AIService } from "./ai.service";

export class PresentationService {
  private presentationRepo: PresentationRepository;
  private userRepo: UserRepository;
  private aiService: AIService;

  constructor() {
    this.presentationRepo = new PresentationRepository();
    this.userRepo = new UserRepository();
    this.aiService = new AIService();
  }

  calculateEstimatedTokens(
    slideCount: number,
    detailLevel: string,
    tonality: string,
  ): number {
    // Base token cost per slide (in slide tokens)
    let baseTokenPerSlide = 1.0;

    // Adjust based on detail level
    const detailMultipliers: Record<string, number> = {
      brief: 0.6,
      concise: 0.8,
      balanced: 1.0,
      detailed: 2.0,
      comprehensive: 3.0,
    };
    baseTokenPerSlide = detailMultipliers[detailLevel] || 1.0;

    // Minor adjustment for tonality complexity
    const tonalityMultipliers: Record<string, number> = {
      casual: 0.9,
      professional: 1.0,
      enthusiastic: 1.05,
      persuasive: 1.1,
    };
    const tonalityMultiplier = tonalityMultipliers[tonality] || 1.0;

    // Calculate total estimated tokens
    const estimatedTokens = slideCount * baseTokenPerSlide * tonalityMultiplier;
    return Math.round(estimatedTokens * 10) / 10;
  }

  async *generatePresentationStream(
    userId: string,
    topic: string,
    slideCount: number,
    detailLevel = "balanced",
    tonality = "professional",
  ): AsyncGenerator<any, void, unknown> {
    // Verify user exists and has enough tokens
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const estimatedTokens = this.calculateEstimatedTokens(
      slideCount,
      detailLevel,
      tonality,
    );

    // Check tokens only for non-unlimited users
    if (!user.isUnlimited && user.slideTokens < estimatedTokens) {
      throw new Error("Insufficient tokens");
    }

    // Deduct tokens upfront (will be skipped for unlimited users in the repo)
    await this.userRepo.deductTokens(userId, estimatedTokens);

    // Stream presentation generation
    yield* this.aiService.generatePresentationStream(
      topic,
      slideCount,
      detailLevel,
      tonality,
    );
  }

  async createPresentation(
    userId: number,
    title: string,
    prompt: string,
    slidesData: any,
  ): Promise<Presentation> {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const presentation = await this.presentationRepo.create(
      userId,
      title,
      prompt,
      slidesData,
    );
    return presentation;
  }

  async getUserPresentations(userId: string): Promise<Presentation[]> {
    return await this.presentationRepo.findByUserId(userId);
  }

  async getPresentation(
    presentationId: string,
    userId: string,
  ): Promise<Presentation> {
    const presentation = await this.presentationRepo.findById(presentationId);

    if (!presentation) {
      throw new Error("Presentation not found");
    }

    if (presentation.userId !== userId) {
      throw new Error("Unauthorized access");
    }

    return presentation;
  }

  async deletePresentation(
    presentationId: string,
    userId: string,
  ): Promise<void> {
    const presentation = await this.presentationRepo.findById(presentationId);

    if (!presentation) {
      throw new Error("Presentation not found");
    }

    if (presentation.userId !== userId) {
      throw new Error("Unauthorized access");
    }

    await this.presentationRepo.delete(presentationId);
  }
}
