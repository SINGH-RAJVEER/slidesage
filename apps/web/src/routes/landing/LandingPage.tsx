import { WordmarkOrb } from "./WordmarkOrb";

export default function LandingPage() {
	return (
		<div
			className="relative h-dvh w-full overflow-hidden bg-[hsl(222_27%_12%)]"
			style={{
				background:
					"radial-gradient(ellipse at 50% 46%, transparent 24%, rgba(4, 7, 14, 0.42) 100%), radial-gradient(100% 85% at 48% 30%, #242c3b 0%, #161b27 65%, #10141e 100%)",
			}}
		>
			<WordmarkOrb />
		</div>
	);
}
