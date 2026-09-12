import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useHorizonTransition } from "../../app/transitions/HorizonTransition";
import { WORDMARK_ORB_FRAGMENT_SHADER, WORDMARK_ORB_VERTEX_SHADER } from "./wordmark-orb-shaders";

const STATIC_ELAPSED = 4.2;
const DRAG_CLICK_SLOP = 6;

/**
 * How often the star field is redrawn.
 *
 * Stars drift across the viewport over minutes and twinkle slowly, so a repaint
 * per animation frame buys nothing anyone can see. The whole field is cleared
 * and repainted each time, which on a large display is the most expensive thing
 * the landing page asks of the main thread; the orb itself still runs at the
 * display's own rate.
 */
const STAR_FRAME_MS = 1000 / 30;

/**
 * Pixel budget for the star canvas.
 *
 * The stars are sub-pixel dots and faint hairlines: rendering them above CSS
 * resolution multiplies the pixels cleared and composited every frame for a
 * difference nobody can point at.
 */
const STAR_MAX_DPR = 1;

/**
 * Pixel budget for the orb.
 *
 * The orb is a smooth gradient behind a scale transform, not text, so it does
 * not need the full device ratio of a 3x phone. The shader antialiases its own
 * silhouette, which is the only edge in it.
 */
const ORB_MAX_DPR = 1.5;

/* Pre-rendered star dots, bucketed by lightness. A filled arc is a path the
   rasterizer builds for every star on every frame; a sprite is a blit. */
const STAR_SPRITE_BUCKETS = 4;
const STAR_SPRITE_RADIUS = 8;

function createStarSprites(): (HTMLCanvasElement | null)[] {
	return Array.from({ length: STAR_SPRITE_BUCKETS }, (_, bucket) => {
		const canvas = document.createElement("canvas");
		const size = STAR_SPRITE_RADIUS * 2;
		canvas.width = size;
		canvas.height = size;
		const context = canvas.getContext("2d");
		if (!has2dContext(context)) return null;
		const lightness = 72 + (bucket / (STAR_SPRITE_BUCKETS - 1)) * 18;
		context.fillStyle = `hsl(212, 62%, ${lightness}%)`;
		context.beginPath();
		context.arc(STAR_SPRITE_RADIUS, STAR_SPRITE_RADIUS, STAR_SPRITE_RADIUS, 0, Math.PI * 2);
		context.fill();
		return canvas;
	});
}

type Star = { x: number; y: number; depth: number; phase: number; drift: number; size: number };

function seeded(index: number, salt: number) {
	return Math.abs(Math.sin(index * 91.173 + salt * 17.719) * 43758.5453) % 1;
}

function createStars(count: number): Star[] {
	return Array.from({ length: count }, (_, index) => ({
		x: seeded(index, 1),
		y: seeded(index, 2),
		depth: 0.25 + seeded(index, 3) * 0.75,
		phase: seeded(index, 4) * Math.PI * 2,
		drift: 0.35 + seeded(index, 5) * 0.65,
		size: 0.45 + seeded(index, 6) * 1.15,
	}));
}

/* Perspective flights are sampled from absolute time, so both their speed
   and their curved trails stay consistent across refresh rates. */
function flightPoint(
	angle: number,
	offset: number,
	progress: number,
	extent: number,
	gravity: number,
) {
	const depth = 1 - progress * 0.92;
	const radius = (extent * offset) / depth;
	const influence = Math.exp(-radius / (extent * 0.85));
	const bend = gravity * influence * progress * 0.075;
	return { x: Math.cos(angle + bend) * radius, y: Math.sin(angle + bend) * radius };
}

function compile(gl: WebGLRenderingContext, type: number, source: string) {
	const shader = gl.createShader(type);
	if (!shader) return null;
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return null;
	return shader;
}

function fract(value: number) {
	return value - Math.floor(value);
}

function has2dContext(ctx: CanvasRenderingContext2D | null): ctx is CanvasRenderingContext2D {
	return ctx !== null && typeof ctx.clearRect === "function" && typeof ctx.fillRect === "function";
}

function BlackHoleFallback() {
	return (
		<div
			data-black-hole-fallback
			aria-hidden="true"
			className="aspect-square w-[60%] rounded-full"
			style={{
				background:
					"radial-gradient(ellipse at 32% 25%, #697887 0%, #283440 7%, transparent 24%), radial-gradient(ellipse at 80% 62%, #0d3762 0%, transparent 22%), #010203",
			}}
		/>
	);
}

export function WordmarkOrb() {
	const transition = useHorizonTransition();
	const destination = transition?.href ?? "/sign-up";
	const destinationLabel =
		destination === "/sign-up"
			? "SlideSage — sign up"
			: destination === "/sign-in"
				? "SlideSage — sign in"
				: "Open SlideSage";
	const hostRef = useRef<HTMLDivElement>(null);
	const starCanvasRef = useRef<HTMLCanvasElement>(null);
	const stageRef = useRef<HTMLAnchorElement>(null);
	const glCanvasRef = useRef<HTMLCanvasElement>(null);
	const fallbackRef = useRef<HTMLDivElement>(null);
	const dragStartX = useRef(0);
	const dragDistance = useRef(0);

	useEffect(() => {
		const host = hostRef.current;
		const starCanvas = starCanvasRef.current;
		const stage = stageRef.current;
		const glCanvas = glCanvasRef.current;
		if (!host || !starCanvas || !stage || !glCanvas) return undefined;

		const showFallback = () => {
			const fallback = fallbackRef.current;
			if (!fallback) return;
			fallback.style.display = "grid";
			stage.style.display = "none";
		};

		const starContext = starCanvas.getContext("2d", { alpha: true });
		const gl =
			glCanvas.getContext("webgl", { alpha: true, premultipliedAlpha: false, antialias: false }) ??
			glCanvas.getContext("experimental-webgl", {
				alpha: true,
				premultipliedAlpha: false,
				antialias: false,
			});
		if (!has2dContext(starContext) || !gl) {
			showFallback();
			return undefined;
		}
		const webgl = gl as WebGLRenderingContext;

		try {
			const vertex = compile(webgl, webgl.VERTEX_SHADER, WORDMARK_ORB_VERTEX_SHADER);
			const fragment = compile(webgl, webgl.FRAGMENT_SHADER, WORDMARK_ORB_FRAGMENT_SHADER);
			const program = vertex && fragment ? webgl.createProgram() : null;
			if (!vertex || !fragment || !program) throw new Error("black-hole shader init failed");
			webgl.attachShader(program, vertex);
			webgl.attachShader(program, fragment);
			webgl.linkProgram(program);
			if (!webgl.getProgramParameter(program, webgl.LINK_STATUS)) {
				throw new Error("black-hole program link failed");
			}
			webgl.useProgram(program);

			const buffer = webgl.createBuffer();
			webgl.bindBuffer(webgl.ARRAY_BUFFER, buffer);
			webgl.bufferData(
				webgl.ARRAY_BUFFER,
				new Float32Array([-1, -1, 3, -1, -1, 3]),
				webgl.STATIC_DRAW,
			);
			const position = webgl.getAttribLocation(program, "p");
			webgl.enableVertexAttribArray(position);
			webgl.vertexAttribPointer(position, 2, webgl.FLOAT, false, 0, 0);

			const uniforms = {
				time: webgl.getUniformLocation(program, "uT"),
				expansion: webgl.getUniformLocation(program, "uExpansion"),
				resolution: webgl.getUniformLocation(program, "uR"),
			};
			webgl.enable(webgl.BLEND);
			webgl.blendFunc(webgl.SRC_ALPHA, webgl.ONE_MINUS_SRC_ALPHA);
			webgl.clearColor(0, 0, 0, 0);

			const stars = createStars(180);
			const starSprites = createStarSprites();
			const flights = Array.from({ length: 115 }, (_, index) => ({
				angle: seeded(index, 11) * Math.PI * 2,
				offset: 0.12 + seeded(index, 12) * 0.72,
				phase: seeded(index, 13),
				speed: 0.035 + seeded(index, 14) * 0.04,
				length: 0.006 + seeded(index, 15) * 0.01,
			}));
			const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
			const reducedMotion = motionQuery.matches;
			let width = 1;
			let height = 1;
			let starDpr = 1;
			let frame = 0;
			let visible = true;
			let lastStars = Number.NEGATIVE_INFINITY;
			const startedAt = performance.now();

			const resize = () => {
				const bounds = host.getBoundingClientRect();
				width = Math.max(1, bounds.width);
				height = Math.max(1, bounds.height);
				const dpr = Math.min(window.devicePixelRatio || 1, ORB_MAX_DPR);
				starDpr = Math.min(window.devicePixelRatio || 1, STAR_MAX_DPR);

				const starWidth = Math.max(1, Math.round(width * starDpr));
				const starHeight = Math.max(1, Math.round(height * starDpr));
				if (starCanvas.width !== starWidth || starCanvas.height !== starHeight) {
					starCanvas.width = starWidth;
					starCanvas.height = starHeight;
				}

				const stageBounds = stage.getBoundingClientRect();
				const bufferWidth = Math.max(1, Math.round(stageBounds.width * dpr));
				const bufferHeight = Math.max(1, Math.round(stageBounds.height * dpr));
				if (glCanvas.width !== bufferWidth || glCanvas.height !== bufferHeight) {
					glCanvas.width = bufferWidth;
					glCanvas.height = bufferHeight;
				}
				webgl.viewport(0, 0, bufferWidth, bufferHeight);
				webgl.uniform2f(uniforms.resolution, bufferWidth, bufferHeight);
			};

			const drawStars = (elapsed: number, horizonScale: number) => {
				starContext.setTransform(starDpr, 0, 0, starDpr, 0, 0);
				starContext.clearRect(0, 0, starCanvas.width / starDpr, starCanvas.height / starDpr);
				const count = Math.min(stars.length, Math.round((width * height) / 4200));
				for (let index = 0; index < count; index += 1) {
					const star = stars[index];
					if (!star) continue;
					const x = fract(star.x + elapsed * 0.0022 * star.drift) * width;
					const y = fract(star.y - elapsed * 0.0008 * star.depth + 1) * height;
					const twinkle = reducedMotion
						? 0.78
						: 0.58 + Math.sin(elapsed * (0.8 + star.depth) + star.phase) * 0.24;
					const alpha = Math.max(0.08, twinkle * (0.22 + star.depth * 0.48));
					const radius = Math.max(0.35, star.size * star.depth);
					const sprite =
						starSprites[
							Math.min(STAR_SPRITE_BUCKETS - 1, Math.floor(star.depth * STAR_SPRITE_BUCKETS))
						];
					if (!sprite) continue;
					starContext.globalAlpha = alpha;
					starContext.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
				}
				starContext.globalAlpha = 1;
				// Short hairlines approach the viewer and fade before they recycle.
				// The larger horizon bends nearby paths a little more strongly.
				const extent = Math.min(width, height) * 0.42;
				starContext.lineCap = "round";
				for (const flight of flights) {
					const progress = fract(flight.phase + elapsed * flight.speed);
					const fade = Math.min(1, progress / 0.12, (1 - progress) / 0.14);
					starContext.strokeStyle = `rgba(153, 183, 215, ${fade * (0.045 + progress * 0.2)})`;
					starContext.lineWidth = 0.35 + progress * 0.45;
					starContext.beginPath();
					for (let segment = 0; segment <= 4; segment++) {
						const sample = Math.max(0, progress - flight.length * (1 - segment / 4));
						const point = flightPoint(flight.angle, flight.offset, sample, extent, horizonScale);
						if (segment === 0) starContext.moveTo(width / 2 + point.x, height / 2 + point.y);
						else starContext.lineTo(width / 2 + point.x, height / 2 + point.y);
					}
					starContext.stroke();
				}
			};

			const render = (now: number) => {
				frame = 0;
				const elapsed = reducedMotion ? STATIC_ELAPSED : (now - startedAt) * 0.001;
				/* one read per frame, shared by the field and the orb */
				const scale =
					Number(host.parentElement?.style.getPropertyValue("--horizon-scale")) || 1 / 3;
				if (reducedMotion || now - lastStars >= STAR_FRAME_MS) {
					lastStars = now;
					drawStars(elapsed, scale);
				}
				webgl.uniform1f(uniforms.time, elapsed);
				webgl.uniform1f(
					uniforms.expansion,
					Math.max(0, Math.min(1, (scale - 1 / 3) / (1.22 - 1 / 3))),
				);
				webgl.clear(webgl.COLOR_BUFFER_BIT);
				webgl.drawArrays(webgl.TRIANGLES, 0, 3);
				if (!reducedMotion && visible && !document.hidden) frame = requestAnimationFrame(render);
			};

			const start = () => {
				if (reducedMotion) {
					render(performance.now());
					return;
				}
				if (!frame && visible && !document.hidden) frame = requestAnimationFrame(render);
			};
			const stop = () => {
				if (frame) cancelAnimationFrame(frame);
				frame = 0;
			};
			const onVisibilityChange = () => {
				if (document.hidden) stop();
				else start();
			};
			const observer =
				typeof ResizeObserver !== "undefined"
					? new ResizeObserver(() => {
							resize();
							if (reducedMotion) render(performance.now());
						})
					: null;
			const intersection =
				typeof IntersectionObserver !== "undefined"
					? new IntersectionObserver(([entry]) => {
							visible = entry?.isIntersecting ?? true;
							if (visible) start();
							else stop();
						})
					: null;

			resize();
			render(performance.now());
			start();
			observer?.observe(host);
			intersection?.observe(host);
			document.addEventListener("visibilitychange", onVisibilityChange);
			motionQuery.addEventListener?.("change", start);

			return () => {
				stop();
				observer?.disconnect();
				intersection?.disconnect();
				document.removeEventListener("visibilitychange", onVisibilityChange);
				motionQuery.removeEventListener?.("change", start);
				if (buffer) webgl.deleteBuffer(buffer);
				if (program) webgl.deleteProgram(program);
				if (vertex) webgl.deleteShader(vertex);
				if (fragment) webgl.deleteShader(fragment);
			};
		} catch {
			showFallback();
			return undefined;
		}
	}, []);

	const enter = (event: React.MouseEvent<HTMLAnchorElement>) => {
		if (event.detail !== 0 && dragDistance.current > DRAG_CLICK_SLOP) {
			event.preventDefault();
			return;
		}
		if (!transition || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		event.preventDefault();

		const bounds = event.currentTarget.getBoundingClientRect();

		const scale =
			Number(hostRef.current?.parentElement?.style.getPropertyValue("--horizon-scale")) || 1 / 3;
		// Pointer activation follows the visible silhouette, not the square canvas.
		if (
			event.detail !== 0 &&
			Math.hypot(
				event.clientX - bounds.left - bounds.width / 2,
				event.clientY - bounds.top - bounds.height / 2,
			) >
				bounds.height * 0.3 * scale + 6
		)
			return;
		transition.begin({
			x: bounds.left + bounds.width / 2,
			y: bounds.top + bounds.height / 2,
			radius: bounds.height * 0.3 * scale,
			wordmark:
				Number(hostRef.current?.parentElement?.style.getPropertyValue("--horizon-wordmark")) || 0,
		});
	};

	return (
		<div ref={hostRef} className="pointer-events-none absolute inset-0 z-10">
			<canvas ref={starCanvasRef} className="absolute inset-0 h-full w-full" />
			<Link
				to={destination}
				aria-label={destinationLabel}
				ref={stageRef}
				onPointerDown={(event) => {
					dragStartX.current = event.clientX;
					dragDistance.current = 0;
				}}
				onPointerMove={(event) => {
					dragDistance.current += Math.abs(event.clientX - dragStartX.current);
					dragStartX.current = event.clientX;
				}}
				onClick={enter}
				className="pointer-events-auto absolute top-1/2 left-1/2 aspect-square h-[min(76%,560px)] -translate-x-1/2 -translate-y-1/2 cursor-pointer"
			>
				<canvas
					ref={glCanvasRef}
					className="absolute inset-0 h-full w-full"
					style={{
						transform:
							"translate(var(--horizon-deform-x, 0px), var(--horizon-deform-y, 0px)) skewX(var(--horizon-skew, 0deg)) scaleY(var(--horizon-stretch, 1)) scale(var(--horizon-scale, 0.333333))",
					}}
				/>
				<img
					src="/landing/slidesage-wordmark-current.png"
					alt=""
					aria-hidden="true"
					draggable={false}
					className="pointer-events-none absolute inset-0 h-full w-full object-contain"
					style={{
						opacity: "var(--horizon-wordmark, 0)",
						transform: "scale(var(--horizon-scale, 0.333333))",
					}}
				/>
			</Link>
			<div
				ref={fallbackRef}
				style={{ display: "none" }}
				className="absolute inset-0 place-items-center"
			>
				<Link
					to={destination}
					aria-label={destinationLabel}
					onPointerDown={(event) => {
						dragStartX.current = event.clientX;
						dragDistance.current = 0;
					}}
					onPointerMove={(event) => {
						dragDistance.current += Math.abs(event.clientX - dragStartX.current);
						dragStartX.current = event.clientX;
					}}
					onClick={enter}
					className="pointer-events-auto grid aspect-square h-[min(76%,560px)] place-items-center"
				>
					<div
						className="relative grid h-full w-full place-items-center"
						style={{
							transform:
								"translate(var(--horizon-deform-x, 0px), var(--horizon-deform-y, 0px)) skewX(var(--horizon-skew, 0deg)) scaleY(var(--horizon-stretch, 1)) scale(var(--horizon-scale, 0.333333))",
						}}
					>
						<BlackHoleFallback />
						<img
							src="/landing/slidesage-wordmark-current.png"
							alt=""
							aria-hidden="true"
							draggable={false}
							className="pointer-events-none absolute inset-0 h-full w-full object-contain"
							style={{ opacity: "var(--horizon-wordmark, 0)" }}
						/>
					</div>
				</Link>
			</div>
		</div>
	);
}
