import { ChevronDown } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface TonalitySelectorProps {
	tonality: string;
	onTonalityChange: (tonality: string) => void;
}

export const TonalitySelector: React.FC<TonalitySelectorProps> = ({
	tonality,
	onTonalityChange,
}) => {
	return (
		<div className="flex items-center gap-2">
			<span className="text-white/70 text-sm">Tonality:</span>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="outline"
						className="w-36 bg-white/10 border-white/20 text-white hover:bg-white/20 transition-all duration-200 hover:border-white/30 justify-between"
					>
						{tonality.charAt(0).toUpperCase() + tonality.slice(1)}
						<ChevronDown className="h-4 w-4 ml-2 opacity-50" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent className="w-36 border-white/20 bg-white/10 backdrop-blur-md shadow-2xl text-white">
					<DropdownMenuItem
						onClick={() => onTonalityChange("professional")}
						className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
					>
						Professional
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => onTonalityChange("casual")}
						className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
					>
						Casual
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => onTonalityChange("enthusiastic")}
						className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
					>
						Enthusiastic
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => onTonalityChange("persuasive")}
						className="text-white/80 focus:text-white focus:bg-white/20 cursor-pointer"
					>
						Persuasive
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
};
