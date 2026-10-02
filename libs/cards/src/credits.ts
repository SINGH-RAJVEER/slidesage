/**
 * Stock photo libraries as their guidelines ask to be named and linked in
 * photo credits. Unsplash links carry its referral parameters.
 */
export const STOCK_LIBRARIES: Record<string, { name: string; url: string }> = {
	// Keep credits for Pexels photos in decks saved before the Unsplash switch.
	pexels: { name: "Pexels", url: "https://www.pexels.com" },
	unsplash: {
		name: "Unsplash",
		url: "https://unsplash.com/?utm_source=slidesage&utm_medium=referral",
	},
};
