import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cn } from "@slidesage/ui/lib/utils";
import { X } from "lucide-react";
import * as React from "react";

const Sheet = SheetPrimitive.Root;

const SheetTrigger = SheetPrimitive.Trigger;

const SheetClose = SheetPrimitive.Close;

const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
	React.ElementRef<typeof SheetPrimitive.Overlay>,
	React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
	<SheetPrimitive.Overlay
		ref={ref}
		className={cn(
			"fixed inset-0 z-50 bg-black/70 data-[state=closed]:animate-[ss-fade-out_200ms_ease-in] data-[state=open]:animate-[ss-fade-in_200ms_ease-out]",
			className,
		)}
		{...props}
	/>
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const SIDES = {
	bottom:
		"inset-x-0 bottom-0 mx-auto w-full max-w-xl max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t pb-[max(1.5rem,env(safe-area-inset-bottom))] data-[state=closed]:animate-[ss-sheet-out-bottom_200ms_ease-in] data-[state=open]:animate-[ss-sheet-in-bottom_260ms_cubic-bezier(0.2,0.9,0.2,1)]",
	right:
		"inset-y-0 right-0 h-full w-3/4 max-w-sm overflow-y-auto border-l pb-[env(safe-area-inset-bottom)] data-[state=closed]:animate-[ss-sheet-out-right_200ms_ease-in] data-[state=open]:animate-[ss-sheet-in-right_260ms_cubic-bezier(0.2,0.9,0.2,1)]",
} as const;

interface SheetContentProps extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content> {
	side?: keyof typeof SIDES;
}

const SheetContent = React.forwardRef<
	React.ElementRef<typeof SheetPrimitive.Content>,
	SheetContentProps
>(({ side = "bottom", className, children, ...props }, ref) => (
	<SheetPortal>
		<SheetOverlay />
		<SheetPrimitive.Content
			ref={ref}
			className={cn(
				"fixed z-50 flex flex-col gap-4 border-white/10 bg-[hsl(222,27%,12%)] p-6 text-white shadow-2xl outline-none",
				SIDES[side],
				className,
			)}
			{...props}
		>
			{side === "bottom" && (
				<div aria-hidden className="mx-auto -mt-3 h-1 w-10 shrink-0 rounded-full bg-white/20" />
			)}
			{children}
			<SheetPrimitive.Close className="absolute right-3 top-3 flex size-11 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30">
				<X className="size-5" />
				<span className="sr-only">Close</span>
			</SheetPrimitive.Close>
		</SheetPrimitive.Content>
	</SheetPortal>
));
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
	<div className={cn("flex flex-col gap-1 pr-10 text-left", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
	<div className={cn("mt-auto flex flex-col gap-2", className)} {...props} />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
	React.ElementRef<typeof SheetPrimitive.Title>,
	React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
	<SheetPrimitive.Title
		ref={ref}
		className={cn("text-lg font-semibold text-white", className)}
		{...props}
	/>
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
	React.ElementRef<typeof SheetPrimitive.Description>,
	React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
	<SheetPrimitive.Description
		ref={ref}
		className={cn("text-sm text-white/55", className)}
		{...props}
	/>
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetOverlay,
	SheetPortal,
	SheetTitle,
	SheetTrigger,
};
