import { Input } from "@slidesage/ui/components/input";
import { Search, X } from "lucide-react";

interface SearchBarProps {
	/** Identifies the input so the page can label it. */
	id: string;
	/** Accessible name for the input; not shown. */
	label: string;
	value: string;
	onChange: (query: string) => void;
	placeholder: string;
}

/**
 * The application-wide search field. Controlled, so the page owning the query
 * can clear it from elsewhere, such as an empty-state "Clear search" action.
 */
export function SearchBar({ id, label, value, onChange, placeholder }: SearchBarProps) {
	return (
		<div className="w-full min-w-0">
			<div className="relative w-full">
				<div className="relative flex items-center rounded-lg border border-white/10 bg-black/20 px-4 py-2.5 transition-colors focus-within:border-white/25">
					<Search className="h-5 w-5 text-white/40 transition-colors group-focus-within:text-white/70" />
					<label htmlFor={id} className="sr-only">
						{label}
					</label>
					<Input
						id={id}
						type="text"
						placeholder={placeholder}
						value={value}
						onChange={(event) => onChange(event.target.value)}
						className="h-auto flex-1 border-0 bg-transparent px-3 text-base text-white placeholder:text-white/35 shadow-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
					/>
					{value.length > 0 && (
						<button
							type="button"
							onClick={() => onChange("")}
							className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-white/60 transition-all hover:bg-white/20 hover:text-white"
							aria-label="Clear search"
						>
							<X className="h-3.5 w-3.5" />
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
