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
import { PrefetchLink } from "../../app/PrefetchLink";
import { ROUTES } from "../../app/router/paths";
import { TemplatePreview } from "./TemplatePreview";
import { useTemplateLibrary } from "./template-library";

// The picker sits on the dark marketplace surface, so its controls use the
// white-on-navy styling the rest of the app draws by hand.
const SELECTED = "bg-white/10 text-white hover:bg-white/15";
const UNSELECTED = "text-white/70 hover:bg-white/10 hover:text-white";

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
	const [installedOnly, setInstalledOnly] = useState(false);
	const templates = CARD_TEMPLATES.filter(
		(template) => !installedOnly || library.ids.includes(template.id),
	);
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!busy) onOpenChange(next);
			}}
		>
			<DialogContent
				className="max-h-[85vh] overflow-y-auto bg-[#181e2a] text-white sm:max-w-5xl [&>button]:data-[state=open]:bg-transparent [&>button]:data-[state=open]:text-white/70"
				aria-busy={busy}
			>
				<DialogHeader>
					<DialogTitle>Choose a template</DialogTitle>
					<DialogDescription className="text-white/60">
						Apply colors and fonts to keep your content, or replace all {slideCount} slides with an
						editable starter deck and its photos. You can undo either change.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-wrap gap-2">
					<Button
						variant="ghost"
						className={installedOnly ? UNSELECTED : SELECTED}
						onClick={() => setInstalledOnly(false)}
					>
						All templates
					</Button>
					<Button
						variant="ghost"
						className={installedOnly ? SELECTED : UNSELECTED}
						onClick={() => setInstalledOnly(true)}
					>
						Installed
					</Button>
					<Button asChild variant="link" className="text-white">
						<PrefetchLink to={ROUTES.marketplace}>Open marketplace</PrefetchLink>
					</Button>
				</div>
				{templates.length === 0 && (
					<p className="py-8 text-white/60">
						Install templates in the marketplace to find them here.
					</p>
				)}
				<div className="grid gap-8 sm:grid-cols-2">
					{templates.map((template) => (
						<section key={template.id} className="space-y-3">
							<TemplatePreview template={template} />
							<h3 className="font-medium">{template.name}</h3>
							<p className="text-sm text-white/60">
								{CARD_THEME_DEFINITIONS[template.theme].name} / {template.document.cardOrder.length}{" "}
								slides
							</p>
							<div className="flex flex-wrap gap-2">
								<Button
									variant="ghost"
									className={SELECTED}
									disabled={busy || disabled}
									onClick={() => onTheme(template)}
								>
									Apply theme
								</Button>
								<Button
									variant="outline"
									className="border-white/15 bg-transparent text-white hover:bg-white/10 hover:text-white"
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
