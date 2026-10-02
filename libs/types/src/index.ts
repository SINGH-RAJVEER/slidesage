/** Stages the generation worker reports over SSE, in the order they occur. */
export type PresentationGenerationStage = "planning" | "drafting" | "finalizing";

export interface Source {
	url: string;
	title?: string;
	snippet?: string;
	retrieved_at?: string;
	published_date?: string;
	author?: string;
	highlights?: string[];
	summary?: string;
}

export interface ResearchPayload {
	sources: Source[];
	estimated_tokens?: number;
}

export const AI_PROVIDERS = ["openai", "google", "anthropic"] as const;
export type AIProvider = (typeof AI_PROVIDERS)[number];

export interface AIModelSelection {
	provider: AIProvider;
	model: string;
}

export interface AIModelDescriptor extends AIModelSelection {
	label: string;
	description: string;
	recommended?: boolean;
}

export interface AIConnectionSummary {
	provider: AIProvider;
	status: "valid" | "invalid";
	enabled: boolean;
	keyHint: string;
	validatedAt: string;
	lastUsedAt?: string;
}

export interface AIConfigurationResponse {
	generation: {
		mode: "openrouter" | "byok";
		model: string | null;
		billing: "points" | "provider";
	};
	eligibility: {
		eligible: boolean;
		slideTokens: number;
		minimumPointsExclusive: 50;
	};
	connections: AIConnectionSummary[];
	models: AIModelDescriptor[];
	modelCatalogErrors?: Partial<Record<AIProvider, string>>;
	selection: AIModelSelection | null;
}

export interface UpdateAIConnectionEnabledRequest {
	enabled: boolean;
}

export interface PresentationData {
	title: string;
	totalSlides: number;
	sources?: Source[];
	tokens_used?: number;
}

export type PresentationStatus = "generating" | "ready" | "failed";

export interface PresentationRetryOptions {
	prompt: string;
	slide_count: number;
	detail_level: string;
	tonality: string;
	research_enabled: boolean;
	research_payload?: ResearchPayload;
	ai?: AIModelSelection;
}

export interface PresentationFailure {
	message: string;
	retry: PresentationRetryOptions;
}

/** The card revision a finished presentation currently points at. */
export interface PresentationRevisionSummary {
	revision: number;
	cardCount: number;
}

export interface PresentationJSON {
	title: string;
	status?: PresentationStatus;
	currentRevision?: PresentationRevisionSummary;
	failure?: PresentationFailure;
	totalSlides?: number;
	tokens_used?: number;
	sources?: Source[];
	[key: string]: unknown;
}

export interface ApiErrorResponse {
	error: {
		message: string;
		code?: string;
	};
}

export interface PresentationSummary {
	id: string;
	title: string;
	prompt: string;
	slide_count: number;
	status: PresentationStatus;
	has_research: boolean;
	created_at: string;
	updated_at: string;
}

export interface PresentationsResponse {
	presentations: PresentationSummary[];
	total: number;
	limit: number;
	offset: number;
	has_more: boolean;
}

export interface SavedPresentation {
	id: string;
	title: string;
	prompt: string;
	slides_data: PresentationJSON;
	created_at: string;
	updated_at: string;
}

export interface PresentationResponse {
	presentation: SavedPresentation;
}

export const LANDING_PAGES = ["generate", "presentations", "landing"] as const;
export type LandingPage = (typeof LANDING_PAGES)[number];

export interface UserProfile {
	id: string;
	name: string | null;
	email: string;
	image: string | null;
	emailVerified: boolean;
	slideTokens: number;
	landingPage: LandingPage;
	createdAt: string;
}

export interface ProfileResponse {
	user: UserProfile;
}

export interface UpdateProfileRequest {
	name?: string;
	email?: string;
	currentPassword?: string;
	newPassword?: string;
	landingPage?: LandingPage;
}

export interface UpdateAvatarRequest {
	imageUrl: string;
}

export interface ProfileAvatarResponse {
	user: Pick<UserProfile, "id" | "image">;
}

export type BillingPackName = "starter" | "pro" | "premium" | "custom";

export interface BillingBalanceResponse {
	slide_tokens: number;
}

export interface BillingCheckoutRequest {
	pack: BillingPackName;
	quantity?: number;
}

export interface BillingCheckoutResponse {
	orderId: string;
	amount: number;
	currency: string;
	tokens: number;
	keyId: string;
}

export interface BillingVerifyRequest {
	razorpay_order_id: string;
	razorpay_payment_id: string;
	razorpay_signature: string;
}

export interface BillingVerifyResponse {
	success: true;
	tokens_awarded: number;
	new_balance: number;
}

/** One planned card in an outline the user reviews before drafting. */
export interface OutlineEntry {
	position: number;
	takeaway: string;
	role: string;
	layout: string;
	evidence?: string;
	sourceIds?: string[];
	/** Photo search for layouts that show a photo. */
	imageQuery?: string;
}

export interface Outline {
	title: string;
	cards: OutlineEntry[];
}

export interface OutlineResponse {
	plan: Outline;
	/** Whether photo layouts may be chosen. */
	photos: boolean;
	slide_tokens_charged: number;
	slide_tokens_remaining: number;
}

/** Cards drafted so far, streamed while a presentation generates. */
export interface DraftPreview {
	title: string;
	entries: Array<Pick<OutlineEntry, "position" | "takeaway" | "layout">>;
	/** Converted cards keyed by position. */
	cards: Record<string, unknown>;
	/** Stored photos those cards show, keyed by asset ID. */
	assets: Record<string, unknown>;
	completed: number;
	total: number;
}
