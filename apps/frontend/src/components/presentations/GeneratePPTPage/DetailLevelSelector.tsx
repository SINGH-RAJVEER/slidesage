import { ChevronDown } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DetailLevelSelectorProps {
	detailLevel: string;
	onDetailLevelChange: (level: string) => void;
}

export const DetailLevelSelector: React.FC<DetailLevelSelectorProps> = ({
	detailLevel,
	onDetailLevelChange,
}) => {
	return (
		<div className="flex items-center gap-2">
			<span className="text-white/70 text-sm">Detail Level:</span>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="outline"
						className="min-w-36 bg-white/10 border-white/20 text-white hover:bg-white/20 transition-all duration-200 hover:border-white/30 justify-between"
					>
						{detailLevel.charAt(0).toUpperCase() + detailLevel.slice(1)}
						<ChevronDown className="h-4 w-4 ml-2 opacity-50" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent className="min-w-36 border-white/20 bg-white/10 backdrop-blur-md shadow-2xl text-white">
					<DropdownMenuItem
						onClick={() => onDetailLevelChange("brief")}
						className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
					>
						Brief
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => onDetailLevelChange("concise")}
						className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
					>
						Concise
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => onDetailLevelChange("balanced")}
						className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
					>
						Balanced
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => onDetailLevelChange("detailed")}
						className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
					>
						Detailed
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => onDetailLevelChange("comprehensive")}
						className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
					>
						Comprehensive
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
};
