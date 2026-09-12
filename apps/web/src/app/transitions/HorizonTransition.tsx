import { useAuth } from "@slidesage/ui";
import { SlideSageLogo } from "@slidesage/ui/components/SlideSageLogo";
import { hasSignedInBefore } from "@slidesage/ui/lib/session-history";
import {
	type CSSProperties,
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { horizonDestination } from "./horizon-destination";
import "./horizon-transition.css";

type Origin = { x: number; y: number; radius: number; wordmark?: number };
type Phase = "cover" | "waiting" | "reveal";
type Transition = { origin: Origin; phase: Phase; href: string };
type HorizonContext = {
	href: string;
	loading: boolean;
	begin: (origin: Origin) => void;
	ready: () => void;
};
const Context = createContext<HorizonContext | null>(null);
export const useHorizonTransition = () => useContext(Context);

/** Pages signal readiness after their initial data request settles, including errors. */
export function useHorizonPageReady(ready = true) {
	const transition = useHorizonTransition();
	const location = useLocation();
	const report = transition?.ready;
	useEffect(() => {
		if (ready) report?.();
	}, [ready, report, location.key]);
}

const nextPaint = () =>
	new Promise<void>((resolve) =>
		requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
	);

export function HorizonTransitionProvider({ children }: { children: ReactNode }) {
	const { isSignedIn, user, loading } = useAuth();
	const href = horizonDestination(isSignedIn, user?.landingPage, hasSignedInBefore());
	const navigate = useNavigate();
	const location = useLocation();
	const [transition, setTransition] = useState<Transition | null>(null);
	const [slow, setSlow] = useState(false);
	const active = useRef(false);
	const runId = useRef(0);
	const destinationKey = useRef<string | null>(null);
	const readyRef = useRef(false);
	const focusPending = useRef(false);
	const routeKey = useRef(location.key);
	const coverRef = useRef<HTMLDivElement>(null);
	const diskRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const animations = useRef<Animation[]>([]);
	const alive = useRef(true);
	const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
			animations.current.forEach((animation) => {
				animation.cancel();
			});
		};
	}, []);

	const begin = useCallback(
		(origin: Origin) => {
			if (active.current || loading) return;
			active.current = true;
			runId.current += 1;
			destinationKey.current = null;
			readyRef.current = false;
			routeKey.current = location.key;
			setSlow(false);
			setTransition({ origin, phase: "cover", href });
			// Warm lazy route code while the horizon is still expanding.
			if (href === "/generate")
				void import("../../routes/presentations/GeneratePPTPage").catch(() => {});
			if (href === "/presentations")
				void import("../../routes/presentations/PresentationsGridPage").catch(() => {});
		},
		[href, loading, location.key],
	);

	const cancel = useCallback(() => {
		runId.current += 1;
		active.current = false;
		readyRef.current = false;
		destinationKey.current = null;
		animations.current.forEach((animation) => {
			animation.cancel();
		});
		animations.current = [];
		setSlow(false);
		setTransition(null);
	}, []);

	useEffect(() => {
		const onBack = () => {
			if (active.current) cancel();
		};
		window.addEventListener("popstate", onBack);
		return () => window.removeEventListener("popstate", onBack);
	}, [cancel]);

	useEffect(() => {
		if (!active.current || !transition) return;
		if (transition.phase === "cover") {
			if (location.key !== routeKey.current) cancel();
		} else if (destinationKey.current === null) {
			if (location.key !== routeKey.current) destinationKey.current = location.key;
		} else if (location.key !== destinationKey.current) cancel();
	}, [location.key, transition?.phase, cancel]);

	const ready = useCallback(() => {
		if (!active.current || location.key === routeKey.current) return;
		readyRef.current = true;
		setTransition((current) =>
			current?.phase === "waiting" ? { ...current, phase: "reveal" } : current,
		);
	}, [location.key]);

	useEffect(() => {
		if (transition?.phase !== "cover" || !diskRef.current) return;
		const { origin } = transition;
		const run = runId.current;
		const radius =
			Math.hypot(
				Math.max(window.innerWidth, window.screen.width),
				Math.max(window.innerHeight, window.screen.height),
			) + 24;

		const finalScale = `scale(${radius / Math.max(1, origin.radius)})`;
		const animation = diskRef.current.animate(
			reduced
				? [
						{ transform: finalScale, opacity: 0, backgroundColor: "hsl(222 27% 12%)" },
						{ transform: finalScale, opacity: 1, backgroundColor: "hsl(222 27% 12%)" },
					]
				: [
						{ transform: "scale(1)", backgroundColor: "#010307" },
						{
							transform: finalScale,
							backgroundColor: "hsl(222 27% 12%)",
						},
					],
			{ duration: reduced ? 180 : 1000, easing: "cubic-bezier(.55,0,.18,1)", fill: "forwards" },
		);
		animations.current.push(animation);
		void animation.finished
			.then(() => {
				if (!alive.current || run !== runId.current) return;
				setTransition((current) => (current ? { ...current, phase: "waiting" } : null));
				void navigate(transition.href);
			})
			.catch(() => {});
	}, [transition?.phase, navigate, reduced]);

	useEffect(() => {
		if (!transition || transition.phase === "cover") return;
		if (transition.phase === "waiting" && readyRef.current)
			setTransition((current) => (current ? { ...current, phase: "reveal" } : null));
		const timer = window.setTimeout(() => setSlow(true), 12000);
		return () => window.clearTimeout(timer);
	}, [transition?.phase]);

	useEffect(() => {
		if (transition?.phase !== "reveal") return;
		let cancelled = false;
		const run = runId.current;
		void (async () => {
			await document.fonts?.ready;
			await nextPaint();
			if (cancelled || run !== runId.current || !contentRef.current || !coverRef.current) return;
			const content = contentRef.current;
			content.style.visibility = "visible";
			const candidates = [
				...content.querySelectorAll<HTMLElement>("header, h1, form > *, [data-horizon-reveal]"),
			];
			const elements = candidates.filter(
				(element) => !candidates.some((other) => other !== element && other.contains(element)),
			);
			for (const [index, element] of elements.entries()) {
				const animation = element.animate(
					[
						{
							opacity: 0,
							transform: reduced ? "none" : "translateY(10px)",
							filter: reduced ? "none" : "blur(2px)",
						},
						{ opacity: 1, transform: "none", filter: "none" },
					],
					{
						duration: reduced ? 160 : 540,
						delay: reduced ? 0 : 100 + Math.min(index * 60, 420),
						fill: "both",
						easing: "cubic-bezier(.2,.7,.2,1)",
					},
				);
				animations.current.push(animation);
			}
			const fade = coverRef.current.animate([{ opacity: 1 }, { opacity: 0 }], {
				duration: reduced ? 160 : 480,
				fill: "forwards",
			});
			animations.current.push(fade);
			await Promise.allSettled(animations.current.map((animation) => animation.finished));
			if (cancelled || run !== runId.current) return;
			animations.current.forEach((animation) => {
				animation.cancel();
			});
			animations.current = [];
			active.current = false;
			focusPending.current = true;
			setTransition(null);
		})();
		return () => {
			cancelled = true;
		};
	}, [transition?.phase, reduced]);

	useEffect(() => {
		if (transition || !focusPending.current) return;
		focusPending.current = false;
		const focus = contentRef.current?.querySelector<HTMLElement>("h1, main, input");
		if (focus) {
			focus.setAttribute("tabindex", "-1");
			// The landing focus is an announcement for assistive tech, so it carries no focus ring:
			// on a full-bleed landmark the ring reads as a stray line across the page.
			focus.setAttribute("data-horizon-focus", "");
			focus.addEventListener(
				"blur",
				() => {
					focus.removeAttribute("data-horizon-focus");
					focus.removeAttribute("tabindex");
				},
				{ once: true },
			);
			focus.focus({ preventScroll: true });
		}
	}, [transition]);

	return (
		<Context.Provider value={{ href, loading, begin, ready }}>
			<div
				ref={contentRef}
				inert={transition !== null}
				className="horizon-route-content"
				style={{ visibility: transition && transition.phase !== "cover" ? "hidden" : "visible" }}
			>
				{children}
			</div>
			{transition && (
				<div
					ref={coverRef}
					className="horizon-route-cover"
					data-phase={transition.phase}
					aria-hidden={!slow}
				>
					<div
						ref={diskRef}
						className="horizon-route-disk"
						style={{
							left: transition.origin.x - transition.origin.radius,
							top: transition.origin.y - transition.origin.radius,
							width: transition.origin.radius * 2,
							height: transition.origin.radius * 2,
						}}
					>
						<div className="horizon-route-reflection" />
					</div>
					{Boolean(transition.origin.wordmark) && (
						<SlideSageLogo
							framed
							className="horizon-route-mark"
							style={
								{
									left: transition.origin.x,
									top: transition.origin.y,
									"--horizon-mark-width": `${transition.origin.radius / 0.3}px`,
									"--horizon-mark-opacity": transition.origin.wordmark,
								} as CSSProperties
							}
						/>
					)}
					<div className="horizon-route-blue" />
					{slow && (
						<div className="horizon-route-wait" role="status">
							<p>Your page is taking a little longer to arrive.</p>
							<button type="button" onClick={() => window.location.assign(transition.href)}>
								Open page directly
							</button>
						</div>
					)}
				</div>
			)}
		</Context.Provider>
	);
}
