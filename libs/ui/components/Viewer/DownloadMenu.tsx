import { Button } from "@slidesage/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@slidesage/ui/components/dropdown-menu";
import { FloatingNotice } from "@slidesage/ui/components/FloatingNotice";
import { ThinkingOrb } from "@slidesage/ui/components/thinking-orb";
import { ChevronDown, Download, Presentation } from "lucide-react";
import type React from "react";
import { useRef, useState } from "react";

interface Props {
	onExport: PresentationExporter;
	/** Set while there is no saved revision to export. */
	disabled?: boolean;
}

/** Downloads the saved revision as a PowerPoint file. */
export type PresentationExporter = () => Promise<void>;

const DownloadMenu: React.FC<Props> = ({ onExport, disabled = false }) => {
	const exportInProgress = useRef(false);
	const [isExporting, setIsExporting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const download = async () => {
		if (exportInProgress.current) return;
		exportInProgress.current = true;
		setIsExporting(true);
		setError(null);
		try {
			await onExport();
		} catch (exportError) {
			console.error("Failed to export PPTX presentation", exportError);
			setError("PPTX export failed. Please try again.");
		} finally {
			exportInProgress.current = false;
			setIsExporting(false);
		}
	};

	return (
		<div className="relative flex flex-col items-start gap-1">
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						type="button"
						disabled={isExporting || disabled}
						variant="outline"
						className="bg-blue-500/10 border-blue-500/20 text-blue-400 hover:bg-blue-500/20 shadow-none transition-colors duration-200"
					>
						{isExporting ? (
							<ThinkingOrb size={20} className="mr-2" />
						) : (
							<Download className="w-4 h-4 mr-2" />
						)}
						{isExporting ? "Exporting PPTX" : "Download"}
						{!isExporting && <ChevronDown className="w-4 h-4 ml-2 opacity-60" />}
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					side="bottom"
					align="start"
					className="w-48 bg-gray-900/80 backdrop-blur-md border border-white/10 text-white shadow-xl"
				>
					<DropdownMenuItem
						disabled={isExporting || disabled}
						onSelect={() => void download()}
						className="focus:bg-white/10 focus:text-white cursor-pointer"
					>
						<Presentation />
						<span>PowerPoint</span>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<FloatingNotice error={error} onDismiss={() => setError(null)} />
		</div>
	);
};

export default DownloadMenu;
