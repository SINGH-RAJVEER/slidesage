import { Button } from "@slidesage/ui/components/button";
import { FloatingNotice } from "@slidesage/ui/components/FloatingNotice";
import { ThinkingOrb } from "@slidesage/ui/components/thinking-orb";
import { ArrowLeft, Coins } from "lucide-react";
import { useLocation } from "react-router-dom";
import Header from "../../app/Header";
import { ROUTES } from "../../app/router/paths";
import { OutlineStudio } from "./OutlineStudio";
import { needsPoints, useOutlineEditor } from "./useOutlineEditor";

/**
 * The plan for a deck, before any card is written. The user can reword
 * points, reorder or remove cards, and choose layouts; drafting then follows
 * the approved outline exactly.
 */
export default function OutlinePage() {
	const location = useLocation();
	return <OutlineVisit key={location.key} />;
}

function OutlineVisit() {
	const editor = useOutlineEditor();
	const { error, loadError, navigate, outline, request, setError } = editor;
	const back = editor.back;

	// The editor fills the viewport, so its action bar stays in reach.
	if (outline) {
		return (
			<div className="flex h-dvh w-full flex-col bg-transparent">
				<Header />
				<FloatingNotice
					error={error}
					onDismiss={() => setError(null)}
					action={
						needsPoints(error)
							? { label: "Get points", onClick: () => navigate(ROUTES.purchase) }
							: null
					}
				/>
				<OutlineStudio editor={editor} />
			</div>
		);
	}

	return (
		<div className="flex min-h-dvh w-full flex-col bg-transparent">
			<Header />
			<FloatingNotice
				error={error}
				onDismiss={() => setError(null)}
				action={
					needsPoints(error)
						? { label: "Get points", onClick: () => navigate(ROUTES.purchase) }
						: null
				}
			/>
			<main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 desktop:px-8">
				{!loadError && (
					<section
						className="flex flex-1 flex-col items-center justify-center gap-4"
						aria-live="polite"
					>
						<ThinkingOrb size={64} />
						<p className="text-sm text-white/70">Planning your presentation</p>
					</section>
				)}
				{loadError && (
					<section
						aria-labelledby="outline-error-title"
						className="flex flex-1 flex-col items-center justify-center text-center"
					>
						<h1
							id="outline-error-title"
							className="text-3xl font-semibold text-white desktop:text-4xl"
						>
							{needsPoints(loadError)
								? "You need more points"
								: "We couldn't plan this outline"}
						</h1>
						<p role="alert" className="mt-3 max-w-xl text-sm leading-6 text-red-200">
							{loadError}
						</p>
						{needsPoints(loadError) ? (
							<p className="mt-3 max-w-xl text-sm leading-6 text-white/45">
								Planning an outline uses points. Add more from the purchase page,
								then try again.
							</p>
						) : null}
						<div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
							{needsPoints(loadError) ? (
								<Button
									onClick={() => navigate(ROUTES.purchase)}
									className="h-11 bg-white px-5 text-[#151c2a] hover:bg-white/90"
								>
									<Coins className="h-4 w-4" />
									Get points
								</Button>
							) : null}
							<Button
								onClick={back}
								variant={needsPoints(loadError) ? "ghost" : "default"}
								className={
									needsPoints(loadError)
										? "h-11 px-5 text-white/70 hover:bg-white/10 hover:text-white"
										: "h-11 bg-white px-5 text-[#151c2a] hover:bg-white/90"
								}
							>
								<ArrowLeft className="h-4 w-4" />
								{request?.researchPayload ? "Back to research" : "Back to generate"}
							</Button>
						</div>
					</section>
				)}
			</main>
		</div>
	);
}
