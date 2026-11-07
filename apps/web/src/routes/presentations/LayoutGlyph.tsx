/** Abstract wireframes of the card layouts, drawn from text bars and photo blocks. */
type Mark = readonly [x: number, y: number, width: number, height: number, weight?: number];

const heading: Mark = [14, 12, 72, 6, 1];
const rows = (x: number, y: number, width: number, count: number, gap = 10): Mark[] =>
	Array.from({ length: count }, (_, at) => [
		x,
		y + at * gap,
		at % 2 ? width * 0.82 : width,
		3,
		0.4,
	]);

const LAYOUT_MARKS: Record<string, readonly Mark[]> = {
	title: [
		[22, 36, 96, 8, 1],
		[22, 50, 58, 4, 0.4],
	],
	statement: [
		[20, 30, 120, 7, 1],
		[20, 42, 92, 7, 1],
		[20, 60, 42, 3, 0.4],
	],
	bullets: [
		heading,
		...[32, 44, 56, 68].flatMap((y): Mark[] => [
			[14, y, 3, 3, 0.7],
			[22, y, y % 8 ? 96 : 118, 3, 0.4],
		]),
	],
	comparison: [
		heading,
		[14, 30, 56, 4, 0.8],
		...rows(14, 42, 56, 3),
		[90, 30, 56, 4, 0.8],
		...rows(90, 42, 56, 3),
	],
	process: [
		heading,
		...[14, 49, 84, 119].flatMap((x): Mark[] => [
			[x, 38, 27, 16, 0.25],
			[x, 60, 27, 3, 0.4],
		]),
	],
	quote: [
		[20, 18, 10, 12, 0.5],
		[36, 34, 104, 5, 0.9],
		[36, 45, 84, 5, 0.9],
		[36, 64, 36, 3, 0.4],
	],
	stats: [
		[14, 22, 72, 6, 1],
		...[14, 62, 110].flatMap((x): Mark[] => [
			[x, 40, 34, 14, 0.9],
			[x, 60, 30, 3, 0.4],
		]),
	],
	"image-left": [[0, 0, 70, 90, 0.2], [84, 24, 62, 6, 1], ...rows(84, 40, 62, 3)],
	"image-right": [[90, 0, 70, 90, 0.2], [14, 24, 62, 6, 1], ...rows(14, 40, 62, 3)],
	cover: [
		[0, 0, 160, 90, 0.2],
		[14, 58, 92, 7, 1],
		[14, 70, 54, 3, 0.5],
	],
	chart: [
		heading,
		...[0, 1, 2, 3, 4, 5].map(
			(at): Mark => [18 + at * 22, 74 - (at + 1) * 7, 14, (at + 1) * 7, 0.2 + at * 0.13],
		),
	],
	table: [
		heading,
		[14, 30, 132, 5, 0.6],
		...[40, 50, 60, 70].flatMap((y): Mark[] => [
			[14, y, 40, 3, 0.4],
			[62, y, 36, 3, 0.25],
			[106, y, 40, 3, 0.25],
		]),
	],
	dashboard: [
		heading,
		[14, 28, 62, 24, 0.22],
		[84, 28, 62, 24, 0.22],
		[14, 58, 62, 22, 0.22],
		[84, 58, 62, 22, 0.22],
	],
};

export function LayoutGlyph({ layout, className }: { layout: string; className?: string }) {
	return (
		<svg viewBox="0 0 160 90" aria-hidden="true" className={className} fill="currentColor">
			{(LAYOUT_MARKS[layout] ?? []).map(([x, y, width, height, weight = 1], index) => (
				<rect
					key={`${index}-${x}-${y}`}
					x={x}
					y={y}
					width={width}
					height={height}
					rx={1.5}
					opacity={weight}
				/>
			))}
		</svg>
	);
}
