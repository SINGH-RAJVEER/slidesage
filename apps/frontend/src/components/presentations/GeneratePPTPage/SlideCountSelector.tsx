import { ChevronDown } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface SlideCountSelectorProps {
	slideCountMode: string;
	slideCount: string;
	customSlideCount: string;
	onSlideCountModeChange: (mode: string) => void;
	onSlideCountChange: (count: string) => void;
	onCustomSlideCountChange: (count: string) => void;
}

export const SlideCountSelector: React.FC<SlideCountSelectorProps> = ({
	slideCountMode,
	slideCount,
	customSlideCount,
	onSlideCountModeChange,
	onSlideCountChange,
	onCustomSlideCountChange,
}) => {
	return (
		<div className="flex items-center gap-2">
			<span className="text-white/70 text-sm">Slides:</span>
			{slideCountMode === "preset" ? (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="outline"
							className="w-24 bg-white/10 border-white/20 text-white hover:bg-white/20 transition-all duration-200 hover:border-white/30 justify-between"
						>
							{slideCount}
							<ChevronDown className="h-4 w-4 ml-2 opacity-50" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent className="w-24 border-white/20 bg-white/10 backdrop-blur-md shadow-2xl text-white">
						{[5, 10, 15, 20, 25, 30].map((count) => (
							<DropdownMenuItem
								key={count}
								onClick={() => {
									onSlideCountChange(count.toString());
									onCustomSlideCountChange(count.toString());
									onSlideCountModeChange("preset");
								}}
								className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
							>
								{count}
							</DropdownMenuItem>
						))}
						<DropdownMenuItem
							onClick={() => onSlideCountModeChange("custom")}
							className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
						>
							Custom
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			) : (
				<input
					type="number"
					min={1}
					max={35}
					value={customSlideCount}
					onChange={(e) => {
						const val = e.target.value;
						if (/^\d{0,2}$/.test(val) && Number(val) <= 35) {
							onCustomSlideCountChange(val);
						}
					}}
					onBlur={() => {
						let val = Number(customSlideCount);
						if (isNaN(val) || val < 1) val = 1;
						if (val > 35) val = 35;
						onCustomSlideCountChange(val.toString());
						onSlideCountChange(val.toString());
						onSlideCountModeChange("preset");
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							let val = Number(customSlideCount);
							if (isNaN(val) || val < 1) val = 1;
							if (val > 35) val = 35;
							onCustomSlideCountChange(val.toString());
							onSlideCountChange(val.toString());
							onSlideCountModeChange("preset");
						} else if (e.key === "Escape") {
							onSlideCountModeChange("preset");
						}
					}}
					className="w-24 px-3 py-2 rounded-md border border-white/20 bg-white/10 text-white focus:outline-none focus:ring-2 focus:ring-blue-400 hide-number-spin"
					placeholder="1-35"
					inputMode="numeric"
					style={{ MozAppearance: "textfield" }}
				/>
			)}
		</div>
	);
};
