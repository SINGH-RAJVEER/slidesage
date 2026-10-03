import { CARD_THEME_DEFINITIONS, getCardTemplate } from "@slidesage/cards";
import { useAuth } from "@slidesage/ui";
import { Button } from "@slidesage/ui/components/button";
import { API_URL } from "@slidesage/ui/lib/api";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Header from "../../app/Header";
import { ROUTES } from "../../app/router/paths";
import { useHorizonPageReady } from "../../app/transitions/HorizonTransition";
import { TemplatePreview } from "./TemplatePreview";
import { useTemplateLibrary } from "./template-library";

export default function TemplateDetailPage() {
	useHorizonPageReady(true);
	const { templateId } = useParams();
	const template = getCardTemplate(templateId ?? "");
	const library = useTemplateLibrary();
	const [error, setError] = useState("");
	const [creating, setCreating] = useState(false);
	const [operationId] = useState(() => crypto.randomUUID());
	const navigate = useNavigate();
	const { isSignedIn } = useAuth();
	const create = async () => {
		if (!template) return;
		if (!isSignedIn) {
			navigate(
				`${ROUTES.signIn}?redirect_url=${encodeURIComponent(ROUTES.templateById(template.id))}`,
			);
			return;
		}
		setCreating(true);
		setError("");
		try {
			const response = await fetch(
				`${API_URL}/templates/${encodeURIComponent(template.id)}/presentations`,
				{
					method: "POST",
					credentials: "include",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ operationId }),
				},
			);
			const body = (await response.json()) as {
				presentationId?: string;
				error?: { message?: string };
			};
			if (!response.ok || !body.presentationId)
				throw new Error(body.error?.message ?? "The presentation could not be created.");
			navigate(ROUTES.presentationById(body.presentationId));
		} catch (error) {
			setError(error instanceof Error ? error.message : "The presentation could not be created.");
		} finally {
			setCreating(false);
		}
	};
	return (
		<div className="dark min-h-screen bg-[#181e2a] text-foreground">
			<Header sticky />
			<main className="mx-auto max-w-6xl space-y-8 px-4 py-10 md:px-10">
				<Link className="text-sm text-muted-foreground underline" to={ROUTES.marketplace}>
					Back to templates
				</Link>
				{!template ? (
					<h1 className="text-3xl">Template not found</h1>
				) : (
					<>
						<div className="space-y-4">
							<h1 className="text-4xl font-light tracking-tight">{template.name}</h1>
							<p className="text-muted-foreground">{template.description}</p>
							<p className="text-sm text-muted-foreground">
								{CARD_THEME_DEFINITIONS[template.theme].name} theme /{" "}
								{template.document.cardOrder.length} editable slides
							</p>
							<div className="flex flex-wrap gap-3">
								<Button disabled={creating} onClick={() => void create()}>
									{creating ? "Creating presentation…" : "Use template"}
								</Button>
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
									{library.ids.includes(template.id) ? "Remove from library" : "Install template"}
								</Button>
							</div>
							<p className="max-w-2xl text-sm text-muted-foreground">
								In your presentation, choose Edit, then Templates. Keep your content and apply this
								theme, or explicitly replace it with these starter slides. Use template creates a
								separate presentation with these slides and photos. No AI generation is needed.
							</p>
							{error && (
								<p role="alert" className="text-destructive">
									{error}
								</p>
							)}
						</div>
						<div className="space-y-8">
							{template.document.cardOrder.map((cardId, index) => (
								<section key={cardId} aria-label={`Slide ${index + 1}`} className="space-y-2">
									<p className="text-sm text-muted-foreground">
										{index + 1} / {template.document.cardOrder.length}
									</p>
									<TemplatePreview template={template} cardId={cardId} />
								</section>
							))}
						</div>
					</>
				)}
			</main>
		</div>
	);
}
