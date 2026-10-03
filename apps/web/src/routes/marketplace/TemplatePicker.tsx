import { CARD_TEMPLATES, CARD_THEME_DEFINITIONS, type CardTemplate } from "@slidesage/cards";
import { Button } from "@slidesage/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@slidesage/ui/components/dialog";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ROUTES } from "../../app/router/paths";
import { TemplatePreview } from "./TemplatePreview";
import { useTemplateLibrary } from "./template-library";

export function TemplatePicker({
	open,
	onOpenChange,
	slideCount,
	busy,
	disabled,
	onTheme,
	onReplace,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	slideCount: number;
	busy: boolean;
	disabled: boolean;
	onTheme: (template: CardTemplate) => void;
	onReplace: (template: CardTemplate) => Promise<void>;
}) {
	const library = useTemplateLibrary();
	const [savedOnly, setSavedOnly] = useState(false);
	const templates = CARD_TEMPLATES.filter(
		(template) => !savedOnly || library.ids.includes(template.id),
	);
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!busy) onOpenChange(next);
			}}
		>
			<DialogContent
				className="dark max-h-[85vh] overflow-y-auto bg-[#181e2a] text-foreground sm:max-w-5xl"
				aria-busy={busy}
			>
				<DialogHeader>
					<DialogTitle>Choose a template</DialogTitle>
					<DialogDescription>
						Apply colors and fonts to keep your content, or replace all {slideCount} slides with an
						editable starter deck and its photos. You can undo either change.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-wrap gap-2">
					<Button variant={savedOnly ? "ghost" : "secondary"} onClick={() => setSavedOnly(false)}>
						All templates
					</Button>
					<Button variant={savedOnly ? "secondary" : "ghost"} onClick={() => setSavedOnly(true)}>
						Saved library
					</Button>
					<Button asChild variant="link">
						<Link to={ROUTES.marketplace}>Open marketplace</Link>
					</Button>
				</div>
				{templates.length === 0 && (
					<p className="py-8 text-muted-foreground">
						Save templates in the marketplace to find them here.
					</p>
				)}
				<div className="grid gap-8 sm:grid-cols-2">
					{templates.map((template) => (
						<section key={template.id} className="space-y-3">
							<TemplatePreview template={template} />
							<h3 className="font-medium">{template.name}</h3>
							<p className="text-sm text-muted-foreground">
								{CARD_THEME_DEFINITIONS[template.theme].name} / {template.document.cardOrder.length}{" "}
								slides
							</p>
							<div className="flex flex-wrap gap-2">
								<Button
									variant="secondary"
									disabled={busy || disabled}
									onClick={() => onTheme(template)}
								>
									Apply theme
								</Button>
								<Button
									variant="outline"
									disabled={busy || disabled}
									onClick={() => void onReplace(template)}
								>
									Replace all slides
								</Button>
							</div>
						</section>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}
