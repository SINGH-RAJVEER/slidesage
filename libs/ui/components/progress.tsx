import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@slidesage/ui/lib/utils";
import type * as React from "react";

function Progress({
	className,
	value,
	...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
	return (
		<ProgressPrimitive.Root
			data-slot="progress"
			className={cn("relative h-1 w-full overflow-hidden rounded-full bg-white/10", className)}
			value={value}
			{...props}
		>
			<ProgressPrimitive.Indicator
				data-slot="progress-indicator"
				className="h-full w-full flex-1 rounded-full bg-white/70 transition-transform duration-700 ease-out motion-reduce:transition-none"
				style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
			/>
		</ProgressPrimitive.Root>
	);
}

export { Progress };
