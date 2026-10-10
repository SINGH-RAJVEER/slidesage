/* Route code is imported from one place, so the router and a hover prefetch
   load the same module and the browser fetches each chunk once. */
export const routeModules = {
	landing: () => import("../../routes/landing/LandingPage"),
	shared: () => import("../../routes/presentations/SharedPresentationPage"),
	generate: () => import("../../routes/presentations/GeneratePPTPage"),
	outline: () => import("../../routes/presentations/OutlinePage"),
	research: () => import("../../routes/presentations/GenerateResearchPage"),
	marketplace: () => import("../../routes/marketplace/MarketplacePage"),
	marketplacePreview: () => import("../../routes/marketplace/MarketplaceThemePreviewPage"),
	presentations: () => import("../../routes/presentations/PresentationsGridPage"),
	presentation: () => import("../../routes/presentations/PresentationPage"),
	presentationError: () => import("../../routes/presentations/PresentationErrorPage"),
	purchase: () => import("../../routes/billing/PurchaseTokensPage"),
};
