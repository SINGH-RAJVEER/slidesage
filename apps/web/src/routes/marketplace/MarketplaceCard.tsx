import type { CardTemplate } from "@slidesage/cards";
import { TemplatePreview } from "./TemplatePreview";

interface MarketplaceCardProps {
	template: CardTemplate;
	onOpen: (templateId: string) => void;
}

export default function MarketplaceCard({ template, onOpen }: MarketplaceCardProps) {
	return (
		<article className="group min-w-0 break-inside-avoid">
			<button
				type="button"
				onClick={() => onOpen(template.id)}
				aria-label={`Preview ${template.name} template`}
				className="relative block aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-black/30 text-left shadow-[0_18px_50px_rgba(0,0,0,0.16)] transition duration-300 group-hover:-translate-y-1 group-hover:border-white/20 group-hover:shadow-[0_24px_65px_rgba(0,0,0,0.28)] focus:outline-none focus:ring-2 focus:ring-amber-100/35"
			>
				{/* The cover card's photo credits are links; inert keeps the button
				    the only thing to click or tab to. */}
				<div aria-hidden inert className="pointer-events-none absolute inset-0">
					<TemplatePreview template={template} />
				</div>
				<div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#111827]/70 via-transparent to-transparent opacity-60" />
			</button>

			<div className="flex items-start gap-3 px-1 pb-2 pt-4">
				<button
					type="button"
					onClick={() => onOpen(template.id)}
					className="min-w-0 flex-1 text-left focus:outline-none"
				>
					<h2 className="truncate text-base font-semibold text-white">{template.name}</h2>
					<p className="mt-0.5 line-clamp-2 text-sm text-white/45">{template.description}</p>
				</button>
			</div>
		</article>
	);
}
