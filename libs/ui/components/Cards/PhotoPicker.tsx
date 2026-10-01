import { STOCK_LIBRARIES } from "@slidesage/cards";
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
	/** The library the photo comes from, such as "pexels" or "unsplash". */
	provider: string;
	id: string;
	width: number;
	height: number;
	alt: string;
	photographer: string;
	photographerUrl?: string;
	thumbnail: string;
}

/** One page of search results and the libraries that can be searched. */
export interface PhotoSearch {
	photos: StockPhoto[];
	provider: string;
	providers: string[];
}

export interface PhotoPickerProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Suggested search, usually the card's heading. */
	initialQuery: string;
	/** Searches one library, or the default one when none is named. */
	search: (query: string, provider?: string) => Promise<PhotoSearch>;
	choose: (photo: StockPhoto, query: string) => Promise<void>;
	upload: (file: File) => Promise<void>;
}

const creditLink = "underline-offset-2 hover:text-white hover:underline";

/** "Photo by X on Library", each linked, as the libraries ask beside every result. */
function PhotoCredit({ photo }: { photo: StockPhoto }) {
	const library = STOCK_LIBRARIES[photo.provider];
	return (
		<p className="mt-1 truncate text-xs text-white/50">
			Photo by{" "}
			{photo.photographerUrl ? (
				<a
					href={photo.photographerUrl}
					target="_blank"
					rel="noreferrer noopener"
					className={creditLink}
				>
					{photo.photographer}
				</a>
			) : (
				photo.photographer
			)}
			{library && (
				<>
					{" "}
					on{" "}
					<a href={library.url} target="_blank" rel="noreferrer noopener" className={creditLink}>
						{library.name}
					</a>
				</>
			)}
		</p>
	);
}

/**
 * Finds a photo for a card, from a stock library or the user's own files.
 * Each library asks apps that search it to link to it wherever results appear.
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
	const [results, setResults] = useState<PhotoSearch | null>(null);
	const [busy, setBusy] = useState<"search" | "add" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const fileInput = useRef<HTMLInputElement>(null);

	// The parent opens the picker, which Radix does not report through
	// onOpenChange, so each opening starts fresh from the card's suggestion.
	useEffect(() => {
		if (!open) return;
		setQuery(initialQuery);
		setResults(null);
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

	const find = (provider?: string) => {
		const trimmed = query.trim();
		if (!trimmed) return;
		void run("search", async () => setResults(await search(trimmed, provider)));
	};

	const submit = (event: FormEvent) => {
		event.preventDefault();
		find(results?.provider);
	};

	const photos = results?.photos;
	const library = results ? STOCK_LIBRARIES[results.provider] : undefined;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-3xl border-white/10 bg-[hsl(222,27%,12%)] text-white">
				<DialogHeader>
					<DialogTitle>Choose a photo</DialogTitle>
					<DialogDescription className="text-white/60">
						Search free stock photos or upload your own.
						{library && (
							<>
								{" "}
								<a
									href={library.url}
									target="_blank"
									rel="noreferrer noopener"
									className="underline"
								>
									Photos provided by {library.name}
								</a>
							</>
						)}
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
				{results && results.providers.length > 1 && (
					<fieldset aria-label="Photo library" className="flex gap-1">
						{results.providers.map((provider) => (
							<Button
								key={provider}
								type="button"
								size="sm"
								variant={provider === results.provider ? "secondary" : "ghost"}
								aria-pressed={provider === results.provider}
								disabled={busy !== null}
								onClick={() => find(provider)}
								className={cn(
									provider !== results.provider &&
										"text-white/70 hover:bg-white/10 hover:text-white",
								)}
							>
								{STOCK_LIBRARIES[provider]?.name ?? provider}
							</Button>
						))}
					</fieldset>
				)}
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
							<li key={`${photo.provider}:${photo.id}`}>
								<button
									type="button"
									disabled={busy !== null}
									onClick={() => void run("add", () => choose(photo, query.trim()))}
									className={cn("group block w-full outline-none", busy !== null && "opacity-50")}
								>
									<img
										src={photo.thumbnail}
										alt={photo.alt || query}
										loading="lazy"
										className="aspect-video w-full rounded-md object-cover ring-sky-400 transition group-hover:ring-2 group-focus-visible:ring-2"
									/>
								</button>
								<PhotoCredit photo={photo} />
							</li>
						))}
					</ul>
				)}
			</DialogContent>
		</Dialog>
	);
}
