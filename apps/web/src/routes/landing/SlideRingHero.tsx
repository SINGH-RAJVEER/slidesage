import { useEffect, useRef, useState } from "react";
import { type LandingPlate, landingPlateCount, randomLandingPool } from "./landing-plates";
import { WordmarkOrb } from "./WordmarkOrb";

/* Ring geometry and motion, adapted from the Gallery Heading matte gallery:
   a tilted ellipse of 16:9 plates in constant orbit — cursor or no cursor.
   Dragging rotates the ring in direct proportion to the drag's length, and
   any plate opens in a hovering preview when clicked. */
const AXIS = (-25.5 * Math.PI) / 180;
const ORBIT_SECONDS = 26;
/* radians of spin per pixel of horizontal drag */
const DRAG_SENSITIVITY = 1.15;
const DRAG_CLICK_SLOP = 6;
/* slides fetched ahead of the plate that will show them */
const PRELOAD_AHEAD = 4;

/* Plate size as a fraction of the ring's major radius. Small enough that the
   ring can carry a crowd without the plates fusing into a solid band. */
const PLATE_WIDTH = 0.26;
/* How far a plate may sit inside or outside the nominal ellipse, and how far
   above or below its plane, as fractions of the ring's radii. Without this the
   plates would sit on one perfect line and simply collide as the ring fills;
   the spread turns that line into a belt with depth to it. */
const RADIAL_SPREAD = 0.22;
const VERTICAL_SPREAD = 0.55;
/* Range of the per-plate size multiplier, which keeps a dense ring from
   reading as one repeated stamp. */
const SIZE_SPREAD = 0.22;

/* Plates are allowed to crowd and overlap, but nearby plates on the same part
   of the ring push each other apart. A spring keeps that push close to the
   ellipse instead of letting the belt slowly expand. */
const REPULSION_ACCELERATION = 520;
const REPULSION_DAMPING = 7;
const ORBIT_SPRING = 8;
const REPULSION_DISTANCE = 0.86;
const MAX_REPULSION_OFFSET = 0.4;

interface PlateProjection {
	x: number;
	y: number;
	width: number;
	height: number;
	depth: number;
}

interface PlateMotion {
	x: number;
	y: number;
	vx: number;
	vy: number;
}

function applyPlateRepulsion(
	projections: PlateProjection[],
	motion: PlateMotion[],
	dt: number,
	maxOffset: number,
) {
	if (dt <= 0 || maxOffset <= 0) return;
	const forces = motion.map(({ x, y }) => ({ x: -x * ORBIT_SPRING, y: -y * ORBIT_SPRING }));

	for (let left = 0; left < projections.length; left += 1) {
		const a = projections[left];
		const aMotion = motion[left];
		if (!a || !aMotion) continue;
		for (let right = left + 1; right < projections.length; right += 1) {
			const b = projections[right];
			const bMotion = motion[right];
			if (!b || !bMotion) continue;

			const dx = b.x + bMotion.x - (a.x + aMotion.x);
			const dy = b.y + bMotion.y - (a.y + aMotion.y);
			const rangeX = ((a.width + b.width) / 2) * REPULSION_DISTANCE;
			const rangeY = ((a.height + b.height) / 2) * REPULSION_DISTANCE;
			const proximity = Math.hypot(dx / rangeX, dy / rangeY);
			if (proximity >= 1) continue;

			/* Cards far apart in depth should still be able to pass over one
			   another. Cards in the same layer resist a pile-up more strongly. */
			const depthAffinity = Math.max(0.2, 1 - Math.abs(a.depth - b.depth) / 0.3);
			const pressure = REPULSION_ACCELERATION * (1 - proximity) ** 2 * depthAffinity;
			const distance = Math.hypot(dx, dy);
			/* Exact coincidence is rare, but a stable fallback direction keeps the
			   pair from remaining locked together. */
			const directionX = distance > 0.01 ? dx / distance : left % 2 === 0 ? 1 : -1;
			const directionY = distance > 0.01 ? dy / distance : 0;
			const leftForce = forces[left];
			const rightForce = forces[right];
			if (!leftForce || !rightForce) continue;
			leftForce.x -= directionX * pressure;
			leftForce.y -= directionY * pressure;
			rightForce.x += directionX * pressure;
			rightForce.y += directionY * pressure;
		}
	}

	const damping = Math.exp(-REPULSION_DAMPING * dt);
	for (let index = 0; index < motion.length; index += 1) {
		const particle = motion[index];
		const force = forces[index];
		if (!particle || !force) continue;
		particle.vx = (particle.vx + force.x * dt) * damping;
		particle.vy = (particle.vy + force.y * dt) * damping;
		particle.x += particle.vx * dt;
		particle.y += particle.vy * dt;

		const offset = Math.hypot(particle.x, particle.y);
		if (offset > maxOffset) {
			const limit = maxOffset / offset;
			particle.x *= limit;
			particle.y *= limit;
			particle.vx *= limit;
			particle.vy *= limit;
		}
	}
}

/**
 * How much of an orbit a plate spends fading out and back in around the back of
 * the ring, as a fraction either side of the crossing point.
 *
 * A plate is refilled as it crosses the back, and the swap has to happen where
 * nobody can see it. It used to be enough that the orb stood in the way, but the
 * belt's spread means a plate now crosses the back well clear of the orb's
 * silhouette as often as behind it. So the plate takes itself out instead: it is
 * already at its smallest and faintest there, and dimming the last of the way to
 * nothing reads as distance rather than as a plate disappearing.
 */
const SWAP_DIP = 0.06;

/**
 * Where one plate sits relative to its nominal place on the ellipse.
 *
 * Seeded from the plate's ring position rather than drawn at random, so the
 * belt is laid out identically on every frame and across a resize - a plate
 * that jittered per frame would shake rather than orbit.
 */
function plateSpread(index: number) {
	const noise = (salt: number) =>
		(Math.abs(Math.sin(index * 78.233 + salt * 12.9898) * 43758.5453) % 1) * 2 - 1;
	return {
		radius: 1 + noise(1) * RADIAL_SPREAD,
		lift: noise(2) * VERTICAL_SPREAD,
		size: 1 + noise(3) * SIZE_SPREAD,
		/* nudges the plate off its evenly-spaced slot, so a dense ring does not
		   read as a rank of evenly spaced cards */
		phase: noise(4) * 0.5,
	};
}

/**
 * Loads a slide off-screen so it is ready to paint before it reaches a plate.
 *
 * `decode()` rather than the load event: a loaded image is downloaded, not yet
 * rasterised, and handing one to a plate leaves the decode to happen on the
 * frame it first paints - which is exactly the hitch this preloading exists to
 * avoid. Browsers without `decode()` fall back to the load event.
 *
 * Resolves null for a slide the CDN will not serve, which drops it from the
 * pool: a template published before slide previews existed contributes its
 * cover and nothing else, instead of putting a broken plate on the ring.
 */
function preloadSlide(entry: LandingPlate): Promise<LandingPlate | null> {
	return new Promise((resolve) => {
		const image = new Image();
		image.decoding = "async";
		const settle = () => {
			if (typeof image.decode !== "function") {
				resolve(entry);
				return;
			}
			image.decode().then(
				() => resolve(entry),
				/* decoded-but-broken is still unusable on a plate */
				() => resolve(null),
			);
		};
		image.onload = settle;
		image.onerror = () => resolve(null);
		image.src = entry.slideUrl;
	});
}

/* How long the reveal will wait on a decode before showing the plate regardless. */
const REVEAL_DEADLINE_MS = 700;

/**
 * Fades a plate up once its slide can actually paint, so it arrives rather than
 * pops.
 *
 * The shell rather than the image, because a plate is not just its slide: it
 * carries a hairline ring and a drop shadow, and fading the image alone would
 * leave an empty outlined box sitting in the ring until the slide landed -
 * trading one artifact for another. Both live on the shell, so both arrive
 * together.
 *
 * A CSS transition rather than the frame loop, because the plate's own opacity
 * is written every frame from its depth in the ring. The two nest, so they
 * multiply, and the reveal does not depend on the loop running.
 */
function revealSlide(image: HTMLImageElement) {
	const shell = image.parentElement;
	if (!shell) return;
	const show = () => {
		shell.style.opacity = "1";
	};
	if (typeof image.decode !== "function") {
		show();
		return;
	}
	/* Waiting on the decode means the fade cannot start over a bitmap that is
	   not ready yet, which would pop mid-fade. But nothing may hold a plate
	   hostage to a promise: a decode that rejects, or that a browser declines to
	   settle, must not leave a hole in the ring - so the fade starts anyway
	   shortly after. */
	image.decode().then(show, show);
	setTimeout(show, REVEAL_DEADLINE_MS);
}

/**
 * Settles a plate's image the moment it is mounted.
 *
 * A cached image is already complete before React can attach a load handler,
 * and `load` does not bubble, so the handler never fires - which on a warm
 * cache means every plate sits at zero and the ring is simply not there. The
 * mount is the only place that case can be caught.
 */
function attachSlide(image: HTMLImageElement | null, plate: LandingPlate) {
	if (!image?.complete) return;
	if (image.naturalWidth > 0) revealSlide(image);
	/* complete with no pixels is a failure the error handler will not be told
	   about either, for the same reason */ else onSlideError({ currentTarget: image }, plate);
}

/* A slide preview that will not load shows its template's cover instead. */
function onSlideError(event: { currentTarget: HTMLImageElement }, plate: LandingPlate) {
	const image = event.currentTarget;
	if (image.getAttribute("data-fallback") === "true") {
		/* the cover failed too: leave the plate hidden rather than parade an
		   empty outlined box round the ring */
		return;
	}
	image.setAttribute("data-fallback", "true");
	image.src = plate.coverUrl;
}

export function SlideRingHero() {
	const rootRef = useRef<HTMLDivElement>(null);
	const plateRefs = useRef<(HTMLDivElement | null)[]>([]);
	/* the open preview holds its own plate, so the ring may recycle the plate
	   it was opened from without the dialog changing under the reader */
	const [preview, setPreview] = useState<LandingPlate | null>(null);
	const [previewShown, setPreviewShown] = useState(false);
	/* drawn once per visit, so the ring is never the same two loads running */
	const [pool] = useState<LandingPlate[]>(() => randomLandingPool());
	/* sized once, at mount: the ring's plate count is structural, and rebuilding
	   the ring mid-resize would restart every plate's orbit */
	const [ring, setRing] = useState<LandingPlate[]>(() =>
		/* a width of zero means the window has not reported one yet; a full ring
		   is the better guess there than a phone's */
		pool.slice(0, landingPlateCount(window.innerWidth || 1440)),
	);
	/* what the frame loop reads; `ring` is only what React paints */
	const ringRef = useRef(ring);

	useEffect(() => {
		const root = rootRef.current;
		if (!root) return undefined;
		const count = ringRef.current.length;
		if (!count) return undefined;

		const reducedMotion =
			typeof window.matchMedia === "function" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches;

		let width = 0;
		let height = 0;
		let plateBaseWidth = 0;
		let spin = 0;
		let last = performance.now();
		let frameId = 0;
		let disposed = false;

		/* Whether the ring is going anywhere. A plate only needs to duck out for
		   its refill if it is going to come back; on the single static frame a
		   reduced-motion visitor gets, a plate parked at the crossing would just
		   be missing from the ring for good. Dragging turns the ring even there,
		   so a drag opts back in. */
		let turning = !reducedMotion;

		/* drag state */
		let dragging = false;
		let dragMoved = 0;
		let dragIndex = -1;
		let lastX = 0;

		/* Slides waiting their turn, and the ones already decoded. A plate that
		   leaves the ring goes back on the queue, so the pool cycles rather
		   than running dry — and its second time round costs no bytes. */
		const queue = pool.slice(count);
		const ready: LandingPlate[] = [];
		let loading = 0;

		const pump = () => {
			while (ready.length + loading < PRELOAD_AHEAD && queue.length) {
				const entry = queue.shift();
				if (!entry) break;
				loading += 1;
				void preloadSlide(entry).then((loaded) => {
					loading -= 1;
					if (disposed) return;
					if (loaded) ready.push(loaded);
					pump();
				});
			}
		};

		/* Refills one plate with the next decoded slide. Called as the plate
		   passes the back of the ring, where the orb hides it and it is at its
		   smallest and faintest, so the change never happens in plain sight. */
		const recycle = (index: number) => {
			const next = ready.shift();
			if (!next) {
				/* nothing decoded yet: the plate keeps its slide and takes the
				   next pass instead */
				pump();
				return;
			}
			const outgoing = ringRef.current[index];
			if (outgoing) queue.push(outgoing);
			const updated = ringRef.current.slice();
			updated[index] = next;
			ringRef.current = updated;
			setRing(updated);
			pump();
		};

		/* completed turns per plate, counted from the back of the ring; NaN
		   until the first frame seeds them, so seeding is never a pass */
		const passes = new Array<number>(count).fill(Number.NaN);
		const plateMotion: PlateMotion[] = Array.from({ length: count }, () => ({
			x: 0,
			y: 0,
			vx: 0,
			vy: 0,
		}));

		const layout = () => {
			width = root.clientWidth;
			height = root.clientHeight;
			const radiusX = Math.min(width * 0.4, 540);
			/* the plate base size only changes on resize, so layout work stays
			   out of the frame loop */
			plateBaseWidth = radiusX * PLATE_WIDTH;
			for (let i = 0; i < count; i++) {
				const node = plateRefs.current[i];
				if (node) node.style.width = `${plateBaseWidth * plateSpread(i).size}px`;
			}
		};

		const render = (dt = 0) => {
			const cx = width / 2;
			const cy = height / 2;
			const radiusX = Math.min(width * 0.4, 540);
			const radiusY = radiusX * 0.36;
			const cosAxis = Math.cos(AXIS);
			const sinAxis = Math.sin(AXIS);

			const projections: PlateProjection[] = [];
			for (let i = 0; i < count; i++) {
				const spread = plateSpread(i);
				const angle = (i / count) * Math.PI * 2 + spread.phase + spin;
				const depth = (Math.sin(angle) + 1) / 2;
				const ringX = Math.cos(angle) * radiusX * spread.radius;
				const ringY = Math.sin(angle) * radiusY * spread.radius + spread.lift * radiusY;
				const x = cx + ringX * cosAxis - ringY * sinAxis;
				const y = cy + ringX * sinAxis + ringY * cosAxis;
				const scale = 0.62 + 0.38 * depth;
				const width = plateBaseWidth * spread.size * scale;
				projections.push({ x, y, width, height: width * (9 / 16), depth });
			}

			applyPlateRepulsion(projections, plateMotion, dt, plateBaseWidth * MAX_REPULSION_OFFSET);

			for (let i = 0; i < count; i++) {
				const plate = plateRefs.current[i];
				const projection = projections[i];
				const particle = plateMotion[i];
				if (!plate || !projection || !particle) continue;
				const spread = plateSpread(i);
				const angle = (i / count) * Math.PI * 2 + spread.phase + spin;
				const depth = projection.depth;
				const scale = 0.62 + 0.38 * depth;
				plate.style.transform = `translate(${projection.x + particle.x}px, ${projection.y + particle.y}px) translate(-50%, -50%) scale(${scale})`;
				plate.style.zIndex = String(Math.round(depth * 20) + (depth >= 0.5 ? 1 : 0));

				/* depth bottoms out a quarter turn back from the ring's origin,
				   so counting turns from there counts passes behind the orb */
				const cycle = (angle + Math.PI / 2) / (Math.PI * 2);
				const pass = Math.floor(cycle);
				const seen = passes[i];
				passes[i] = pass;
				/* a drag can turn the ring either way; either direction is a
				   pass, and the seed frame is not one */
				if (!Number.isNaN(seen) && seen !== pass) recycle(i);

				/* nothing at the crossing point, easing back to full either side
				   of it, so the refill lands on an invisible plate */
				const fromCrossing = Math.min(cycle - pass, 1 - (cycle - pass));
				const dip = turning ? Math.min(1, fromCrossing / SWAP_DIP) : 1;
				plate.style.opacity = String((0.42 + 0.58 * depth) * dip * dip);
			}
		};

		/* A reduced-motion page still gets the separated resting layout. These
		   fixed steps happen before paint and do not create visible motion. */
		const settleReducedMotion = () => {
			if (!reducedMotion) {
				render();
				return;
			}
			for (let step = 0; step < 48; step += 1) render(1 / 60);
		};

		const frame = (now: number) => {
			const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
			last = now;
			/* the ring always turns; while the pointer drags, the move handler
			   owns spin instead */
			if (!dragging && !reducedMotion) {
				spin += dt / ORBIT_SECONDS;
				render(dt);
			}
			frameId = requestAnimationFrame(frame);
		};

		const onVisibility = () => {
			last = performance.now();
		};

		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as HTMLElement | null;
			const plate = target?.closest("[data-plate-index]");
			dragging = true;
			dragMoved = 0;
			dragIndex = plate?.getAttribute("data-plate-index")
				? Number.parseInt(plate.getAttribute("data-plate-index") ?? "", 10)
				: -1;
			lastX = event.clientX;
		};

		const onPointerMove = (event: PointerEvent) => {
			if (!dragging) return;
			const dx = event.clientX - lastX;
			turning = true;
			const radiusX = Math.min(width * 0.4, 540);
			/* negate the delta so the ring reads as grabbed: dragging right
			   pushes the front plates right */
			const dSpin = -dx / (radiusX * DRAG_SENSITIVITY);
			spin += dSpin;
			dragMoved += Math.abs(dx);
			lastX = event.clientX;
			render(reducedMotion ? 1 / 60 : 0);
		};

		const onPointerUp = () => {
			if (!dragging) return;
			dragging = false;
			if (dragMoved < DRAG_CLICK_SLOP) {
				/* a tap, not a drag: open the plate under the pointer */
				if (dragIndex >= 0) setPreview(ringRef.current[dragIndex] ?? null);
			}
			/* the ring resumes its constant turn on the next frame */
		};

		const observer =
			typeof ResizeObserver !== "undefined"
				? new ResizeObserver(() => {
						layout();
						settleReducedMotion();
					})
				: null;

		layout();
		settleReducedMotion();
		pump();
		observer?.observe(root);
		root.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("pointermove", onPointerMove);
		window.addEventListener("pointerup", onPointerUp);
		window.addEventListener("pointercancel", onPointerUp);
		document.addEventListener("visibilitychange", onVisibility);
		frameId = requestAnimationFrame(frame);

		return () => {
			disposed = true;
			cancelAnimationFrame(frameId);
			observer?.disconnect();
			root.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", onPointerUp);
			window.removeEventListener("pointercancel", onPointerUp);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [pool]);

	useEffect(() => {
		if (!preview) {
			setPreviewShown(false);
			return undefined;
		}
		const frame = requestAnimationFrame(() => setPreviewShown(true));
		return () => cancelAnimationFrame(frame);
	}, [preview]);

	useEffect(() => {
		if (!preview) return undefined;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setPreview(null);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [preview]);

	return (
		<div
			ref={rootRef}
			role="img"
			aria-label="Presentation templates orbiting the SlideSage wordmark"
			className="relative h-full w-full cursor-grab select-none overflow-hidden active:cursor-grabbing"
			style={{
				background: "radial-gradient(120% 90% at 50% -20%, #252a37 0%, #161b27 60%)",
				touchAction: "pan-y",
			}}
		>
			<div aria-hidden className="pointer-events-none absolute inset-0">
				{ring.map((plate, index) => (
					/* keyed by ring position, not by slide: the position is what the
					   frame loop addresses and the DOM ref tracks, while the slide it
					   carries is swapped out under it */
					<div
						key={`plate-${index}`}
						data-plate-index={index}
						ref={(el) => {
							plateRefs.current[index] = el;
						}}
						className="pointer-events-auto absolute top-0 left-0 aspect-video will-change-transform"
					>
						{/* the plate's visible body: slide, ring and shadow together, so
						    the whole plate fades up as one once the slide can paint.
						    Keyed by position, not by slide: once revealed it stays
						    revealed, and a refill is hidden by the plate's dip through
						    the back of the ring rather than by fading the body again. */}
						<div
							style={{
								opacity: 0,
								transition: "opacity 420ms ease-out",
								boxShadow: "0 18px 44px rgba(0, 0, 0, 0.45)",
							}}
							className="absolute inset-0 overflow-hidden rounded-[4%] ring-1 ring-white/10"
						>
							<img
								/* keyed by the slide, so a refill mounts a clean element
								   rather than inheriting the last slide's fallback state */
								key={plate.key}
								ref={(el) => attachSlide(el, plate)}
								src={plate.slideUrl}
								alt=""
								/* Eager, deliberately. A plate is never at rest: it orbits
								   through the viewport whether or not it started there, so
								   deferring the fetch until it arrives guarantees it pops in
								   mid-flight. The whole ring is around a megabyte. */
								decoding="async"
								draggable={false}
								onLoad={(event) => revealSlide(event.currentTarget)}
								onError={(event) => onSlideError(event, plate)}
								className="h-full w-full object-cover"
							/>
						</div>
					</div>
				))}
			</div>
			{/* The wordmark lives on a rotating smoke sphere (see WordmarkOrb);
			    the ring's plates pass over it, and it stays clear of the preview
			    dialog at z-30. */}
			<WordmarkOrb />

			{preview && (
				<div
					role="dialog"
					aria-modal="true"
					aria-label={`Template preview: ${preview.name}`}
					className="absolute inset-0 z-30 flex items-center justify-center"
				>
					<button
						type="button"
						aria-label="Close preview"
						onClick={() => setPreview(null)}
						className={`absolute inset-0 cursor-default bg-[#0c0f16]/70 backdrop-blur-sm transition-opacity duration-300 ${
							previewShown ? "opacity-100" : "opacity-0"
						}`}
					/>
					<div
						className={`relative z-10 aspect-video w-[68%] max-w-[880px] transition-all duration-300 ease-out ${
							previewShown ? "scale-100 opacity-100" : "scale-95 opacity-0"
						}`}
					>
						<div className="h-full w-full overflow-hidden rounded-lg shadow-2xl ring-1 ring-white/15">
							<img
								src={preview.slideUrl}
								alt={`${preview.name}, slide ${preview.slideIndex + 1}`}
								onError={(event) => onSlideError(event, preview)}
								className="h-full w-full object-cover"
							/>
						</div>
						<p className="mt-4 text-center text-xs tracking-wide text-white/50">
							{preview.name} · Slide {preview.slideIndex + 1}
						</p>
					</div>
				</div>
			)}
		</div>
	);
}
