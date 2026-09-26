import { Button } from "@slidesage/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@slidesage/ui/components/dialog";
import { Input } from "@slidesage/ui/components/input";
import { cn } from "@slidesage/ui/lib/utils";
import { Search, Upload } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

/** A stock photo offered for a card. */
export interface StockPhoto {
	id: number;
	width: number;
	height: number;
	alt: string;
	photographer: string;
	thumbnail: string;
}

export interface PhotoPickerProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Suggested search, usually the card's heading. */
	initialQuery: string;
	search: (query: string) => Promise<StockPhoto[]>;
	choose: (photo: StockPhoto, query: string) => Promise<void>;
	upload: (file: File) => Promise<void>;
}

/**
 * Finds a photo for a card, from Pexels or the user's own files. Pexels asks
 * apps that search its library to link to it wherever results appear.
 */
export function PhotoPicker({
	open,
	onOpenChange,
	initialQuery,
	search,
	choose,
	upload,
}: PhotoPickerProps) {
	const [query, setQuery] = useState(initialQuery);
	const [photos, setPhotos] = useState<StockPhoto[] | null>(null);
	const [busy, setBusy] = useState<"search" | "add" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const fileInput = useRef<HTMLInputElement>(null);

	// The parent opens the picker, which Radix does not report through
	// onOpenChange, so each opening starts fresh from the card's suggestion.
	useEffect(() => {
		if (!open) return;
		setQuery(initialQuery);
		setPhotos(null);
		setError(null);
	}, [open, initialQuery]);

	const run = async (kind: "search" | "add", action: () => Promise<void>) => {
		setBusy(kind);
		setError(null);
		try {
			await action();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "Something went wrong.");
		} finally {
			setBusy(null);
		}
	};

	const submit = (event: FormEvent) => {
		event.preventDefault();
		const trimmed = query.trim();
		if (!trimmed) return;
		void run("search", async () => setPhotos(await search(trimmed)));
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-3xl border-white/10 bg-[hsl(222,27%,12%)] text-white">
				<DialogHeader>
					<DialogTitle>Choose a photo</DialogTitle>
					<DialogDescription className="text-white/60">
						Search free stock photos or upload your own.{" "}
						<a
							href="https://www.pexels.com"
							target="_blank"
							rel="noreferrer noopener"
							className="underline"
						>
							Photos provided by Pexels
						</a>
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={submit} className="flex gap-2">
					<Input
						aria-label="Search photos"
						value={query}
						maxLength={100}
						onChange={(event) => setQuery(event.target.value)}
						className="border-white/10 bg-transparent text-white"
					/>
					<Button type="submit" disabled={busy !== null || !query.trim()} className="gap-2">
						<Search className="size-4" />
						Search
					</Button>
					<Button
						type="button"
						variant="ghost"
						disabled={busy !== null}
						onClick={() => fileInput.current?.click()}
						className="gap-2 text-white/80 hover:bg-white/10 hover:text-white"
					>
						<Upload className="size-4" />
						Upload
					</Button>
					<input
						ref={fileInput}
						type="file"
						accept="image/png,image/jpeg,image/webp,image/gif"
						className="hidden"
						aria-label="Upload a photo"
						onChange={(event) => {
							const file = event.target.files?.[0];
							event.target.value = "";
							if (file) void run("add", () => upload(file));
						}}
					/>
				</form>
				{error && (
					<p role="alert" className="text-sm text-amber-200">
						{error}
					</p>
				)}
				{busy === "search" && <p className="text-sm text-white/50">Searching</p>}
				{busy === "add" && <p className="text-sm text-white/50">Adding photo</p>}
				{photos && photos.length === 0 && busy === null && (
					<p className="text-sm text-white/50">No photos matched. Try a broader search.</p>
				)}
				{photos && photos.length > 0 && (
					<ul
						aria-label="Photo results"
						className="grid max-h-[55vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3"
					>
						{photos.map((photo) => (
							<li key={photo.id}>
								<button
									type="button"
									disabled={busy !== null}
									onClick={() => void run("add", () => choose(photo, query.trim()))}
									className={cn(
										"group flex w-full flex-col gap-1 text-left outline-none",
										busy !== null && "opacity-50",
									)}
								>
									<img
										src={photo.thumbnail}
										alt={photo.alt || query}
										loading="lazy"
										className="aspect-video w-full rounded-md object-cover ring-sky-400 transition group-hover:ring-2 group-focus-visible:ring-2"
									/>
									<span className="truncate text-xs text-white/50">{photo.photographer}</span>
								</button>
							</li>
						))}
					</ul>
				)}
			</DialogContent>
		</Dialog>
	);
}
