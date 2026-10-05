export const ROUTES = {
	home: "/",
	landing: "/landing",
	signIn: "/sign-in",
	signUp: "/sign-up",
	forgotPassword: "/forgot-password",
	resetPassword: "/reset-password",
	profile: "/profile",
	settings: "/settings",
	feedback: "/feedback",
	generate: "/generate",
	research: "/generate/research",
	outline: "/generate/outline",
	presentations: "/presentations",
	marketplace: "/marketplace",
	marketplacePreview: (marketplaceId: string) =>
		`/marketplace/${encodeURIComponent(marketplaceId)}/preview`,
	presentationById: (presentationId: string) =>
		`/presentations/${encodeURIComponent(presentationId)}`,
	presentationError: "/presentation-error",
	shared: (token: string) => `/s/${encodeURIComponent(token)}`,
	purchase: "/purchase",
} as const;
