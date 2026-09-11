import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@slidesage/ui/components/dropdown-menu";
import MarketplaceCard from "@slidesage/ui/components/Marketplace/MarketplaceCard";
import { SearchBar } from "@slidesage/ui/components/SearchBar";
import { MARKETPLACE_ITEMS, type MarketplaceItem } from "@slidesage/ui/lib/catalog";
import {
	getInstalledMarketplaceThemes,
	installMarketplaceTheme,
	removeMarketplaceTheme,
} from "@slidesage/ui/lib/marketplace-themes";
import { templateThumbnailUrl } from "@slidesage/ui/lib/template-thumbnails";
import { Check, ChevronDown, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../../app/Header";
import { ROUTES } from "../../app/router/paths";

type MarketplaceSort = "catalog" | "name";

function matchesSearch(item: MarketplaceItem, query: string) {
	const searchable = [item.id, item.name, item.description, item.sourceFilename, ...item.tags]
		.join(" ")
		.toLowerCase();
	return searchable.includes(query.trim().toLowerCase());
}

export default function MarketplacePage() {
	const navigate = useNavigate();
	const [sort, setSort] = useState<MarketplaceSort>("catalog");
	const [query, setQuery] = useState("");
	const [installedThemeIds, setInstalledThemeIds] = useState<Set<string>>(
		() => new Set(getInstalledMarketplaceThemes().map((theme) => theme.marketplaceId)),
	);
	const visibleItems = MARKETPLACE_ITEMS.filter((item) => matchesSearch(item, query));
	if (sort === "name") {
		visibleItems.sort((a, b) => (a.name === b.name ? 0 : a.name < b.name ? -1 : 1));
	}

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
				<section className="px-4 py-8 md:px-8 md:py-12">
					<div className="mx-auto max-w-7xl">
						<div className="grid gap-3 border-b border-white/10 pb-6 md:grid-cols-[minmax(16rem,1fr)_auto] md:items-center">
							<SearchBar
								id="marketplace-search"
								label="Search marketplace"
								value={query}
								onChange={setQuery}
								placeholder="Search templates"
							/>
							<div className="flex justify-end">
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<button
											type="button"
											aria-label="Sort marketplace"
											className="flex h-10 items-center gap-2 rounded-full border border-white/10 bg-black/15 px-4 text-sm text-white/60 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-white focus:outline-none focus:ring-2 focus:ring-white/20"
										>
											<SlidersHorizontal className="h-3.5 w-3.5" />
											{sort === "catalog" ? "Catalog order" : "Name A-Z"}
											<ChevronDown className="h-3.5 w-3.5 text-white/35" />
										</button>
									</DropdownMenuTrigger>
									<DropdownMenuContent
										align="end"
										className="min-w-44 rounded-xl border border-white/10 bg-[hsl(222,27%,12%)] p-1 text-white shadow-2xl"
									>
										{(
											[
												{ id: "catalog", label: "Catalog order" },
												{ id: "name", label: "Name A-Z" },
											] as const
										).map((option) => (
											<DropdownMenuItem
												key={option.id}
												onSelect={() => setSort(option.id)}
												className="my-1 cursor-pointer rounded-lg px-3 py-2.5 text-white/70 focus:bg-white/10 focus:text-white"
											>
												<span className="flex-1">{option.label}</span>
												{sort === option.id && <Check className="h-4 w-4 text-amber-100/70" />}
											</DropdownMenuItem>
										))}
									</DropdownMenuContent>
								</DropdownMenu>
							</div>
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
