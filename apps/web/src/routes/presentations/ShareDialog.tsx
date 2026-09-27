import { Button } from "@slidesage/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@slidesage/ui/components/dialog";
import { Input } from "@slidesage/ui/components/input";
import { API_URL } from "@slidesage/ui/lib/api";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { ROUTES } from "../../app/router/paths";

interface Share {
	createdAt: string;
	token?: string;
}

type ShareState =
	| { status: "loading" }
	| { status: "ready"; share: Share | null }
	| { status: "error"; message: string };

export interface ShareDialogProps {
	presentationId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

async function readError(response: Response, fallback: string): Promise<string> {
	const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
	return body?.error?.message ?? fallback;
}

/**
 * Creates, shows, and revokes a presentation's read-only link. The server keeps
 * only a digest of the token, so the link can be copied only right after it is
 * created; a later visit can replace it or turn it off.
 */
export function ShareDialog({ presentationId, open, onOpenChange }: ShareDialogProps) {
	const [state, setState] = useState<ShareState>({ status: "loading" });
	const [busy, setBusy] = useState(false);
	const [copied, setCopied] = useState(false);
	const shareUrl = `${API_URL}/presentations/${encodeURIComponent(presentationId)}/share`;

	useEffect(() => {
		if (!open) return;
		let active = true;
		setState({ status: "loading" });
		setCopied(false);
		void (async () => {
			try {
				const response = await fetch(shareUrl, { credentials: "include" });
				if (!response.ok)
					throw new Error(await readError(response, "Sharing could not be loaded."));
				const body = (await response.json()) as { share: Share | null };
				if (active) setState({ status: "ready", share: body.share });
			} catch (error) {
				if (active) setState({ status: "error", message: (error as Error).message });
			}
		})();
		return () => {
			active = false;
		};
	}, [open, shareUrl]);

	const change = async (method: "POST" | "DELETE") => {
		setBusy(true);
		setCopied(false);
		try {
			const response = await fetch(shareUrl, { method, credentials: "include" });
			if (!response.ok) throw new Error(await readError(response, "Sharing could not be changed."));
			const share = method === "POST" ? ((await response.json()) as { share: Share }).share : null;
			setState({ status: "ready", share });
		} catch (error) {
			setState({ status: "error", message: (error as Error).message });
		} finally {
			setBusy(false);
		}
	};

	const link =
		state.status === "ready" && state.share?.token
			? `${window.location.origin}${ROUTES.shared(state.share.token)}`
			: null;

	const copy = async () => {
		if (!link) return;
		await navigator.clipboard.writeText(link).catch(() => {});
		setCopied(true);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Share</DialogTitle>
					<DialogDescription>
						Anyone with the link can view and present this deck without signing in. They cannot edit
						it.
					</DialogDescription>
				</DialogHeader>
				{state.status === "loading" && (
					<p className="text-sm text-muted-foreground" role="status">
						Loading
					</p>
				)}
				{state.status === "error" && (
					<p className="text-sm text-amber-200" role="alert">
						{state.message}
					</p>
				)}
				{state.status === "ready" && link && (
					<div className="flex flex-col gap-2">
						<div className="flex gap-2">
							<Input
								readOnly
								aria-label="Share link"
								value={link}
								onFocus={(event) => event.currentTarget.select()}
							/>
							<Button onClick={() => void copy()} className="gap-2">
								{copied ? <Check className="size-4" /> : <Copy className="size-4" />}
								{copied ? "Copied" : "Copy"}
							</Button>
						</div>
						<p className="text-xs text-muted-foreground">
							Copy the link now. It is not shown again; you can create a new one later.
						</p>
					</div>
				)}
				{state.status === "ready" && state.share && !link && (
					<p className="text-sm text-muted-foreground">
						A link has been live since {new Date(state.share.createdAt).toLocaleString()}. A new
						link stops the old one from working.
					</p>
				)}
				{state.status === "ready" && !state.share && (
					<p className="text-sm text-muted-foreground">This deck is not shared.</p>
				)}
				{state.status !== "loading" && (
					<div className="flex justify-end gap-2">
						{state.status === "ready" && state.share && (
							<Button variant="ghost" disabled={busy} onClick={() => void change("DELETE")}>
								Stop sharing
							</Button>
						)}
						{!link && (
							<Button disabled={busy} onClick={() => void change("POST")}>
								{state.status === "ready" && state.share ? "Create a new link" : "Create link"}
							</Button>
						)}
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
