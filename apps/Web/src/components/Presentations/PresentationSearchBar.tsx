import { Search, X } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";

interface SearchFilters {
	query: string;
}

interface PresentationSearchBarProps {
	onSearch: (filters: SearchFilters) => void;
}

export function PresentationSearchBar({
	onSearch,
}: PresentationSearchBarProps) {
	const [filters, setFilters] = useState<SearchFilters>({
		query: "",
	});

	const handleFilterChange = (field: keyof SearchFilters, value: string) => {
		const updatedFilters = { ...filters, [field]: value };
		setFilters(updatedFilters);
		onSearch(updatedFilters);
	};

	const clearFilters = () => {
		const emptyFilters: SearchFilters = {
			query: "",
		};
		setFilters(emptyFilters);
		onSearch(emptyFilters);
	};

	const hasActiveFilters = filters.query.length > 0;

	return (
		<div className="mb-12 flex justify-center">
			<div className="relative w-full max-w-2xl group">
				<div className="absolute inset-0 -z-10 rounded-full bg-white/5 blur-xl transition-all duration-500 group-focus-within:bg-white/10 group-focus-within:blur-2xl" />
				<div className="relative flex items-center rounded-full border border-white/10 bg-black/40 px-6 py-3 backdrop-blur-2xl transition-all duration-300 focus-within:border-white/30 focus-within:bg-black/60">
					<Search className="h-5 w-5 text-white/40 transition-colors group-focus-within:text-white/70" />
					<Input
						id="presentation-search"
						type="text"
						placeholder="Search by title, prompt, or date..."
						value={filters.query}
						onChange={(e) => handleFilterChange("query", e.target.value)}
						className="h-auto flex-1 border-0 bg-transparent px-4 text-base text-white placeholder:text-white/30 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none shadow-none"
					/>
					{hasActiveFilters && (
						<button
							type="button"
							onClick={clearFilters}
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
