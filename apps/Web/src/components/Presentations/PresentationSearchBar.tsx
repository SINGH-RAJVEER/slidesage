import { Search, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SearchFilters {
  title: string;
  prompt: string;
  dateFrom: string;
  dateTo: string;
}

interface PresentationSearchBarProps {
  onSearch: (filters: SearchFilters) => void;
}

export function PresentationSearchBar({
  onSearch,
}: PresentationSearchBarProps) {
  const [filters, setFilters] = useState<SearchFilters>({
    title: "",
    prompt: "",
    dateFrom: "",
    dateTo: "",
  });

  const handleFilterChange = (field: keyof SearchFilters, value: string) => {
    const updatedFilters = { ...filters, [field]: value };
    setFilters(updatedFilters);
    onSearch(updatedFilters);
  };

  const clearFilters = () => {
    const emptyFilters: SearchFilters = {
      title: "",
      prompt: "",
      dateFrom: "",
      dateTo: "",
    };
    setFilters(emptyFilters);
    onSearch(emptyFilters);
  };

  const hasActiveFilters =
    filters.title || filters.prompt || filters.dateFrom || filters.dateTo;

  return (
    <div className="mb-8 p-6 bg-white/5 backdrop-blur-sm rounded-lg border border-white/10">
      <div className="flex items-center gap-2 mb-4">
        <Search className="h-5 w-5 text-white/70" />
        <h2 className="text-lg font-semibold text-white">
          Search Presentations
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Title Search */}
        <div className="space-y-2">
          <label htmlFor="title-search" className="text-sm text-white/70">
            Title
          </label>
          <Input
            id="title-search"
            type="text"
            placeholder="Search by title..."
            value={filters.title}
            onChange={(e) => handleFilterChange("title", e.target.value)}
            className="bg-white/5 border-white/20 text-white placeholder:text-white/40 focus:border-white/40"
          />
        </div>

        {/* Prompt Search */}
        <div className="space-y-2">
          <label htmlFor="prompt-search" className="text-sm text-white/70">
            Prompt
          </label>
          <Input
            id="prompt-search"
            type="text"
            placeholder="Search by prompt..."
            value={filters.prompt}
            onChange={(e) => handleFilterChange("prompt", e.target.value)}
            className="bg-white/5 border-white/20 text-white placeholder:text-white/40 focus:border-white/40"
          />
        </div>

        {/* Date From */}
        <div className="space-y-2">
          <label htmlFor="date-from" className="text-sm text-white/70">
            Created From
          </label>
          <Input
            id="date-from"
            type="date"
            value={filters.dateFrom}
            onChange={(e) => handleFilterChange("dateFrom", e.target.value)}
            className="bg-white/5 border-white/20 text-white placeholder:text-white/40 focus:border-white/40"
          />
        </div>

        {/* Date To */}
        <div className="space-y-2">
          <label htmlFor="date-to" className="text-sm text-white/70">
            Created To
          </label>
          <Input
            id="date-to"
            type="date"
            value={filters.dateTo}
            onChange={(e) => handleFilterChange("dateTo", e.target.value)}
            className="bg-white/5 border-white/20 text-white placeholder:text-white/40 focus:border-white/40"
          />
        </div>
      </div>

      {/* Clear Filters Button */}
      {hasActiveFilters && (
        <div className="mt-4 flex justify-end">
          <Button
            onClick={clearFilters}
            variant="ghost"
            size="sm"
            className="text-white/70 hover:text-white hover:bg-white/10"
          >
            <X className="h-4 w-4 mr-2" />
            Clear Filters
          </Button>
        </div>
      )}
    </div>
  );
}
