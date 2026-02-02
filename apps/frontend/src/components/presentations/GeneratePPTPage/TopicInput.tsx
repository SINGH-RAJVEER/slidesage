import { X } from "lucide-react";
import type React from "react";
import { Input } from "@/components/ui/input";

interface TopicInputProps {
	prompt: string;
	topics: string[];
	onPromptChange: (value: string) => void;
	onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
	onRemoveTopic: (topic: string) => void;
	disabled: boolean;
}

export const TopicInput: React.FC<TopicInputProps> = ({
	prompt,
	topics,
	onPromptChange,
	onKeyDown,
	onRemoveTopic,
	disabled,
}) => {
	return (
		<div className="space-y-3">
			<label
				htmlFor="prompt"
				className="block text-lg font-medium text-white/80"
			>
				Presentation Topics
			</label>
			{topics.length > 0 && (
				<div className="flex flex-wrap gap-1.5 p-2 bg-white/5 rounded-lg border border-white/10">
					{topics.map((topic, index) => (
						<div
							key={index}
							className="flex items-center gap-1.5 px-2.5 py-1 bg-white/20 border border-white/30 rounded-full text-white text-sm backdrop-blur-sm hover:bg-white/25 transition-all duration-200"
						>
							<span className="font-medium">{topic}</span>
							<button
								onClick={() => onRemoveTopic(topic)}
								className="hover:bg-white/20 rounded-full p-0.5 transition-colors"
								disabled={disabled}
							>
								<X className="h-3 w-3" />
							</button>
						</div>
					))}
				</div>
			)}
			<Input
				id="prompt"
				placeholder="Type a topic and press Enter"
				value={prompt}
				onChange={(e) => onPromptChange(e.target.value)}
				onKeyDown={onKeyDown}
				className="text-xl bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:border-white/40 h-14"
				disabled={disabled}
			/>
		</div>
	);
};
