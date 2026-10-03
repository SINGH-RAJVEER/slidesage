import { CARD_TEMPLATES, CARD_THEME_DEFINITIONS, type CardTemplate } from "@slidesage/cards";
import { SearchBar } from "@slidesage/ui/components/SearchBar";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../../app/Header";
import { ROUTES } from "../../app/router/paths";
import { useHorizonPageReady } from "../../app/transitions/HorizonTransition";
import MarketplaceCard from "./MarketplaceCard";
import { useTemplateLibrary } from "./template-library";

function matchesSearch(template: CardTemplate, query: string) {
	const searchable = [
		template.id,
		template.name,
		template.description,
		CARD_THEME_DEFINITIONS[template.theme].name,
		...template.tags,
	]
		.join(" ")
		.toLowerCase();
	return searchable.includes(query.trim().toLowerCase());
}

export default function MarketplacePage() {
	useHorizonPageReady(true);
	const navigate = useNavigate();
	const library = useTemplateLibrary();
	const [query, setQuery] = useState("");
	/* Always by name. A catalog the reader cannot reorder is one they can learn
	   the shape of, and alphabetical is the order a name is looked up in. */
	const visibleTemplates = CARD_TEMPLATES.filter((template) => matchesSearch(template, query)).sort(
		(a, b) => a.name.localeCompare(b.name),
	);

	const setInstalled = (templateId: string, installed: boolean) => {
		try {
			library.setInstalled(templateId, installed);
		} catch {
			// Local storage is unavailable, so the button keeps its state.
		}
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

						{visibleTemplates.length > 0 ? (
							<div className="mt-8 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
								{visibleTemplates.map((template) => (
									<MarketplaceCard
										key={template.id}
										template={template}
										installed={library.ids.includes(template.id)}
										onOpen={(id) => navigate(ROUTES.marketplacePreview(id))}
										onInstall={(id) => setInstalled(id, true)}
										onRemove={(id) => setInstalled(id, false)}
									/>
								))}
							</div>
						) : (
							<div className="mt-8 border-y border-white/10 py-24 text-center">
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
