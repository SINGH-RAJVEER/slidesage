import { Button } from "@slidesage/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@slidesage/ui/components/dialog";
import { Textarea } from "@slidesage/ui/components/textarea";
import { useEffect, useState } from "react";

const QUICK_INSTRUCTIONS = [
	"Make it more concise",
	"Add more detail and examples",
	"Make it more persuasive",
	"Use simpler language",
];

export interface ReviseDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** What the revision applies to, for example "Card 3" or "every card". */
	scope: string;
	onSubmit: (instruction: string) => void;
}

/** Asks what to change before an AI revision rewrites the chosen cards. */
export function ReviseDialog({ open, onOpenChange, scope, onSubmit }: ReviseDialogProps) {
	const [instruction, setInstruction] = useState("");

	useEffect(() => {
		if (open) setInstruction("");
	}, [open]);

	const submit = (value: string) => {
		const trimmed = value.trim();
		if (!trimmed) return;
		onSubmit(trimmed);
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Revise with AI</DialogTitle>
					<DialogDescription>
						Rewrites {scope}. Everything else stays as it is, and the result is saved as a new
						version.
					</DialogDescription>
				</DialogHeader>
				<form
					className="flex flex-col gap-3"
					onSubmit={(event) => {
						event.preventDefault();
						submit(instruction);
					}}
				>
					<Textarea
						aria-label="What should change"
						placeholder="For example: tighten the wording and lead with the numbers"
						value={instruction}
						maxLength={1000}
						onChange={(event) => setInstruction(event.target.value)}
						className="min-h-24"
					/>
					<div className="flex flex-wrap gap-2">
						{QUICK_INSTRUCTIONS.map((quick) => (
							<Button
								key={quick}
								type="button"
								variant="outline"
								size="sm"
								onClick={() => submit(quick)}
							>
								{quick}
							</Button>
						))}
					</div>
					<div className="flex justify-end">
						<Button type="submit" disabled={!instruction.trim()}>
							Revise
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
