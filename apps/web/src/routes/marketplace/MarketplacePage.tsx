import { CARD_TEMPLATES, CARD_THEME_DEFINITIONS, TEMPLATE_CATEGORIES } from "@slidesage/cards";
import { Button } from "@slidesage/ui/components/button";
import { Input } from "@slidesage/ui/components/input";
import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import Header from "../../app/Header";
import { ROUTES } from "../../app/router/paths";
import { useHorizonPageReady } from "../../app/transitions/HorizonTransition";
import { TemplatePreview } from "./TemplatePreview";
import { useTemplateLibrary } from "./template-library";

export default function MarketplacePage() {
	useHorizonPageReady(true);
	const library = useTemplateLibrary();
	const isLibrary = useLocation().pathname === ROUTES.templateLibrary;
	const [params, setParams] = useSearchParams();
	const query = params.get("q") ?? "";
	const category = params.get("category") ?? "all";
	const [error, setError] = useState("");
	const updateFilter = (key: string, value: string) => {
		setParams(
			(current) => {
				const next = new URLSearchParams(current);
				if (!value || value === "all") next.delete(key);
				else next.set(key, value);
				return next;
			},
			{ replace: true },
		);
	};
	const templates = CARD_TEMPLATES.filter(
		(template) =>
			(!isLibrary || library.ids.includes(template.id)) &&
			(category === "all" || template.category === category) &&
			[template.name, template.description, template.theme, template.category, ...template.tags]
				.join(" ")
				.toLowerCase()
				.includes(query.trim().toLowerCase()),
	);

	return (
		<div className="dark min-h-screen bg-[#181e2a] text-foreground">
			<Header sticky />
			<main className="mx-auto max-w-7xl space-y-8 px-4 py-10 md:px-10">
				<div className="flex flex-wrap items-end justify-between gap-6">
					<div className="max-w-xl space-y-3">
						<p className="text-sm text-muted-foreground">SlideSage templates</p>
						<h1 className="text-4xl font-light tracking-tight md:text-5xl">
							{isLibrary ? "Your template library" : "Start with a story"}
						</h1>
						<p className="text-muted-foreground">
							{isLibrary
								? "Saved in this browser. Removing a template does not change your presentations."
								: "Browse complete starter decks. Preview every slide, then start your own presentation with its photos, colors and fonts."}
						</p>
					</div>
					<nav aria-label="Template navigation" className="flex gap-2">
						<Button asChild variant={isLibrary ? "outline" : "secondary"}>
							<Link to={ROUTES.marketplace}>Browse templates</Link>
						</Button>
						<Button asChild variant={isLibrary ? "secondary" : "outline"}>
							<Link to={ROUTES.templateLibrary}>Saved library ({library.ids.length})</Link>
						</Button>
					</nav>
				</div>
				<Input
					aria-label="Search templates"
					placeholder="Search titles, topics or themes"
					value={query}
					onChange={(event) => updateFilter("q", event.target.value)}
					className="max-w-xl"
				/>
				<fieldset className="flex flex-wrap gap-2" aria-label="Template categories">
					{[{ id: "all", label: "All categories" }, ...TEMPLATE_CATEGORIES].map((item) => (
						<Button
							key={item.id}
							variant={category === item.id ? "secondary" : "ghost"}
							aria-pressed={category === item.id}
							onClick={() => updateFilter("category", item.id)}
						>
							{item.label}
						</Button>
					))}
				</fieldset>
				{error && (
					<p role="alert" className="text-destructive">
						{error}
					</p>
				)}
				{templates.length === 0 ? (
					<div className="space-y-3 py-16">
						<h2 className="text-2xl">
							{isLibrary && library.ids.length === 0
								? "Your library is empty"
								: "No templates match"}
						</h2>
						<p className="text-muted-foreground">
							{isLibrary && library.ids.length === 0
								? "Install a template from Browse templates to save it here."
								: "Try a different search or category."}
						</p>
						<Button asChild variant="outline">
							<Link to={ROUTES.marketplace}>Browse all templates</Link>
						</Button>
					</div>
				) : (
					<div className="grid gap-x-8 gap-y-12 md:grid-cols-2">
						{templates.map((template) => (
							<article key={template.id} className="space-y-4">
								<div className="relative [&_footer_a]:relative [&_footer_a]:z-20">
									<TemplatePreview template={template} />
									<Link
										to={ROUTES.templateById(template.id)}
										aria-label={`Preview ${template.name}`}
										className="absolute inset-0 rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
									/>
								</div>
								<div className="flex items-start justify-between gap-4">
									<div className="space-y-1">
										<p className="text-xs capitalize text-muted-foreground">
											{template.category} / {template.document.cardOrder.length} slides
										</p>
										<h2 className="text-xl">
											<Link to={ROUTES.templateById(template.id)}>{template.name}</Link>
										</h2>
										<p className="text-sm text-muted-foreground">{template.description}</p>
										<div className="flex flex-wrap items-center gap-2 pt-2 text-xs text-muted-foreground">
											<span
												className="flex gap-1"
												role="img"
												aria-label={`${CARD_THEME_DEFINITIONS[template.theme].name} color palette`}
											>
												{["surface", "heading", "accent"].map((color) => (
													<span
														key={color}
														className="size-3 rounded-full ring-1 ring-white/20"
														style={{
															backgroundColor:
																CARD_THEME_DEFINITIONS[template.theme].palette[
																	color as "surface" | "heading" | "accent"
																],
														}}
													/>
												))}
											</span>
											<span>
												{CARD_THEME_DEFINITIONS[template.theme].fonts.heading.face} /{" "}
												{CARD_THEME_DEFINITIONS[template.theme].fonts.body.face}
											</span>
										</div>
									</div>
									<Button
										variant="outline"
										onClick={() => {
											try {
												library.setInstalled(template.id, !library.ids.includes(template.id));
												setError("");
											} catch {
												setError(
													"Your browser could not save the library. Allow local storage and try again.",
												);
											}
										}}
									>
										{library.ids.includes(template.id) ? "Remove" : "Install"}
									</Button>
								</div>
							</article>
						))}
					</div>
				)}
			</main>
		</div>
	);
}
