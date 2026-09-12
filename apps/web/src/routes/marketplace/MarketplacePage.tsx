import MarketplaceCard from "@slidesage/ui/components/Marketplace/MarketplaceCard";
import { SearchBar } from "@slidesage/ui/components/SearchBar";
import { MARKETPLACE_ITEMS, type MarketplaceItem } from "@slidesage/ui/lib/catalog";
import {
	getInstalledMarketplaceThemes,
	installMarketplaceTheme,
	removeMarketplaceTheme,
} from "@slidesage/ui/lib/marketplace-themes";
import { templateThumbnailUrl } from "@slidesage/ui/lib/template-thumbnails";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../../app/Header";
import { ROUTES } from "../../app/router/paths";

function matchesSearch(item: MarketplaceItem, query: string) {
	const searchable = [item.id, item.name, item.description, item.sourceFilename, ...item.tags]
		.join(" ")
		.toLowerCase();
	return searchable.includes(query.trim().toLowerCase());
}

export default function MarketplacePage() {
	const navigate = useNavigate();
	const [query, setQuery] = useState("");
	const [installedThemeIds, setInstalledThemeIds] = useState<Set<string>>(
		() => new Set(getInstalledMarketplaceThemes().map((theme) => theme.marketplaceId)),
	);
	/* Always by name. A catalog the reader cannot reorder is one they can learn
	   the shape of, and alphabetical is the order a name is looked up in. */
	const visibleItems = MARKETPLACE_ITEMS.filter((item) => matchesSearch(item, query)).sort((a, b) =>
		a.name.localeCompare(b.name),
	);

	const handleInstall = (itemId: string) => {
		if (!installMarketplaceTheme(itemId)) return;
		setInstalledThemeIds((current) => new Set(current).add(itemId));
	};

	const handleRemove = (itemId: string) => {
		if (!removeMarketplaceTheme(itemId)) return;
		setInstalledThemeIds((current) => {
			const next = new Set(current);
			next.delete(itemId);
			return next;
		});
	};

	const handleOpen = (itemId: string) => {
		const item = MARKETPLACE_ITEMS.find((candidate) => candidate.id === itemId);
		if (!item) return;
		navigate(ROUTES.marketplacePreview(item.id));
	};

	return (
		<div className="flex h-dvh flex-col overflow-hidden bg-transparent text-white">
			<Header />
			<main className="min-h-0 flex-1 overflow-y-auto pb-[max(5rem,env(safe-area-inset-bottom))]">
				{/* The top padding matches the presentations grid, so the search bar
				    sits at the same height on both catalog pages. */}
				<section className="px-4 pt-6 pb-8 md:px-8 md:pt-8 md:pb-12">
					<div className="mx-auto max-w-7xl">
						<div className="border-b border-white/10 pb-6">
							<SearchBar
								id="marketplace-search"
								label="Search marketplace"
								value={query}
								onChange={setQuery}
								placeholder="Search templates"
							/>
						</div>

						<div className="mb-7 mt-8 flex justify-end">
							<p className="text-sm text-white/35">{visibleItems.length} templates</p>
						</div>

						{visibleItems.length > 0 ? (
							<div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
								{visibleItems.map((item) => (
									<MarketplaceCard
										key={item.id}
										item={{ ...item, thumbnailUrl: templateThumbnailUrl(item.thumbnailPath) }}
										installed={installedThemeIds.has(item.id)}
										onOpen={handleOpen}
										onInstall={handleInstall}
										onRemove={handleRemove}
									/>
								))}
							</div>
						) : (
							<div className="border-y border-white/10 py-24 text-center">
								<p className="font-serif text-3xl text-[#f3ead5]">
									No design answers that search yet.
								</p>
								<button
									type="button"
									onClick={() => setQuery("")}
									className="mt-5 text-sm font-medium text-white/50 underline decoration-white/20 underline-offset-4 hover:text-white"
								>
									Clear search
								</button>
							</div>
						)}
					</div>
				</section>
			</main>
		</div>
	);
}
