export const ROUTES = {
	home: "/",
	landing: "/landing",
	signIn: "/sign-in",
	signUp: "/sign-up",
	forgotPassword: "/forgot-password",
	resetPassword: "/reset-password",
	profile: "/profile",
	settings: "/settings",
	generate: "/generate",
	research: "/generate/research",
	presentations: "/presentations",
	presentationById: (presentationId: string) =>
		`/presentations/${encodeURIComponent(presentationId)}`,
	presentationError: "/presentation-error",
	purchase: "/purchase",
} as const;
