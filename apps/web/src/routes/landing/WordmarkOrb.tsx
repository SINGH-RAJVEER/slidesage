import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { WORDMARK_ORB_FRAGMENT_SHADER, WORDMARK_ORB_VERTEX_SHADER } from "./wordmark-orb-shaders";

const STATIC_ELAPSED = 4.2;
const DRAG_CLICK_SLOP = 6;

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
			glCanvas.getContext("webgl", { alpha: true, premultipliedAlpha: false, antialias: true }) ??
			glCanvas.getContext("experimental-webgl", {
				alpha: true,
				premultipliedAlpha: false,
				antialias: true,
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
				resolution: webgl.getUniformLocation(program, "uR"),
			};
			webgl.enable(webgl.BLEND);
			webgl.blendFunc(webgl.SRC_ALPHA, webgl.ONE_MINUS_SRC_ALPHA);
			webgl.clearColor(0, 0, 0, 0);

			const stars = createStars(180);
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
			const startedAt = performance.now();

			const resize = () => {
				const bounds = host.getBoundingClientRect();
				width = Math.max(1, bounds.width);
				height = Math.max(1, bounds.height);
				const dpr = Math.min(window.devicePixelRatio || 1, 2);
				starDpr = Math.min(window.devicePixelRatio || 1, 1.5);

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

			const drawStars = (elapsed: number) => {
				starContext.setTransform(starDpr, 0, 0, starDpr, 0, 0);
				starContext.clearRect(0, 0, starCanvas.width / starDpr, starCanvas.height / starDpr);
				const count = Math.min(stars.length, Math.round((width * height) / 4200));
				starContext.globalCompositeOperation = "screen";
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
					starContext.fillStyle = `hsla(212, 62%, ${72 + star.depth * 18}%, ${alpha})`;
					starContext.beginPath();
					starContext.arc(x, y, radius, 0, Math.PI * 2);
					starContext.fill();
				}
				// Short hairlines approach the viewer and fade before they recycle.
				// The larger horizon bends nearby paths a little more strongly.
				const horizonScale =
					Number(host.parentElement?.style.getPropertyValue("--horizon-scale")) || 1 / 3;
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
				starContext.globalCompositeOperation = "source-over";
			};

			const render = (now: number) => {
				frame = 0;
				const elapsed = reducedMotion ? STATIC_ELAPSED : (now - startedAt) * 0.001;
				drawStars(elapsed);
				webgl.uniform1f(uniforms.time, elapsed);
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

	return (
		<div ref={hostRef} className="pointer-events-none absolute inset-0 z-10">
			<canvas ref={starCanvasRef} className="absolute inset-0 h-full w-full" />
			<Link
				to="/sign-up"
				aria-label="SlideSage — sign up"
				ref={stageRef}
				onPointerDown={(event) => {
					dragStartX.current = event.clientX;
					dragDistance.current = 0;
				}}
				onPointerMove={(event) => {
					dragDistance.current += Math.abs(event.clientX - dragStartX.current);
					dragStartX.current = event.clientX;
				}}
				onClick={(event) => {
					if (dragDistance.current > DRAG_CLICK_SLOP) event.preventDefault();
				}}
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
					to="/sign-up"
					aria-label="SlideSage — sign up"
					className="grid aspect-square h-[min(76%,560px)] place-items-center"
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
