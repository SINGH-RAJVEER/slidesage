import { useAuth } from "@slidesage/ui";
import { hasSignedInBefore } from "@slidesage/ui/lib/session-history";
import {
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

type Origin = { x: number; y: number; radius: number };
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
	const readyRef = useRef(false);
	const routeKey = useRef(location.key);
	const coverRef = useRef<HTMLDivElement>(null);
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

	const ready = useCallback(() => {
		if (!active.current || location.key === routeKey.current) return;
		readyRef.current = true;
		setTransition((current) =>
			current?.phase === "waiting" ? { ...current, phase: "reveal" } : current,
		);
	}, [location.key]);

	useEffect(() => {
		if (transition?.phase !== "cover" || !coverRef.current) return;
		const { origin } = transition;
		const radius =
			Math.hypot(
				Math.max(origin.x, window.innerWidth - origin.x),
				Math.max(origin.y, window.innerHeight - origin.y),
			) + 24;
		const animation = coverRef.current.animate(
			[
				{ clipPath: `circle(${origin.radius}px at ${origin.x}px ${origin.y}px)` },
				{ clipPath: `circle(${radius}px at ${origin.x}px ${origin.y}px)` },
			],
			{ duration: reduced ? 180 : 1100, easing: "cubic-bezier(.55,0,.18,1)", fill: "forwards" },
		);
		animations.current.push(animation);
		void animation.finished
			.then(() => {
				if (!alive.current) return;
				setTransition((current) => (current ? { ...current, phase: "waiting" } : null));
				void navigate(transition.href);
			})
			.catch(() => {});
	}, [transition?.phase, navigate, reduced]);

	useEffect(() => {
		if (transition?.phase !== "waiting") return;
		if (readyRef.current)
			setTransition((current) => (current ? { ...current, phase: "reveal" } : null));
		const timer = window.setTimeout(() => setSlow(true), 12000);
		return () => window.clearTimeout(timer);
	}, [transition?.phase]);

	useEffect(() => {
		if (transition?.phase !== "reveal") return;
		let cancelled = false;
		void (async () => {
			await document.fonts?.ready;
			await nextPaint();
			if (cancelled || !contentRef.current || !coverRef.current) return;
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
							transform: reduced ? "none" : "translateY(14px)",
							filter: reduced ? "none" : "blur(4px)",
						},
						{ opacity: 1, transform: "none", filter: "none" },
					],
					{
						duration: reduced ? 160 : 600,
						delay: reduced ? 0 : Math.min(index * 65, 520),
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
			if (cancelled) return;
			animations.current.forEach((animation) => {
				animation.cancel();
			});
			animations.current = [];
			active.current = false;
			setTransition(null);
			const focus = content.querySelector<HTMLElement>("h1, main");
			if (focus) {
				focus.setAttribute("tabindex", "-1");
				focus.focus({ preventScroll: true });
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [transition?.phase, reduced]);

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
					aria-hidden={!slow}
					style={{
						clipPath: `circle(${transition.origin.radius}px at ${transition.origin.x}px ${transition.origin.y}px)`,
					}}
				>
					<div className="horizon-route-blue" />
					{slow && transition.phase === "waiting" && (
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
