import type { ClerkProvider } from "@clerk/clerk-react";
import type { ComponentProps } from "react";

export const clerkAppearance: NonNullable<
	ComponentProps<typeof ClerkProvider>["appearance"]
> = {
	variables: {
		colorBackground: "rgba(255, 255, 255, 0.06)",
		colorText: "rgba(255, 255, 255, 0.95)",
		colorTextSecondary: "rgba(255, 255, 255, 0.75)",
		colorPrimary: "rgba(255, 255, 255, 0.18)",
		colorInputBackground: "rgba(255, 255, 255, 0.08)",
		colorInputText: "rgba(255, 255, 255, 0.95)",
		colorNeutral: "rgba(255, 255, 255, 0.90)",
		colorDanger: "rgb(248, 113, 113)",
		borderRadius: "0.9rem",
	},

	elements: {
		rootBox: "mx-auto",

		cardBox:
			"shadow-2xl !border !border-white/20 !bg-white/10 backdrop-blur-md !w-[32rem] !max-w-[calc(100vw-2.5rem)]",

		card: "!bg-transparent !border-0 !shadow-none !p-10 sm:!p-12 !gap-8",
		headerTitle: "!text-white text-4xl font-bold",
		headerSubtitle: "!text-white/80 text-lg",

		socialButtons: "!gap-3",
		socialButtonsBlockButton:
			"!bg-white/10 hover:!bg-white/20 !text-white !border !border-white/20 h-12 text-base font-medium transition-all duration-200",
		socialButtonsBlockButtonText: "!text-white font-medium",

		dividerLine: "!bg-white/30",
		dividerText: "!text-white/60 text-sm",

		formFieldLabel: "!text-white/80 text-base font-medium",
		formFieldRow: "!mt-1",
		formFieldInput:
			"!bg-white/10 !border !border-white/20 !text-white placeholder:!text-white/50 focus:!border-white/40 focus:!ring-white/20 h-12 text-base",
		formFieldInputShowPasswordButton: "!text-white/70 hover:!text-white",

		formButtonPrimary:
			"!bg-white/15 hover:!bg-white/25 backdrop-blur-lg !border !border-white/30 !text-white shadow-[0_8px_32px_0_rgba(255,255,255,0.10)] hover:shadow-[0_8px_32px_0_rgba(255,255,255,0.20)] h-12 text-base font-semibold transition-all duration-300",

		footer: "!bg-transparent mt-6 pt-6 !border-t !border-white/10",

		footerActionLink:
			"!text-white hover:!text-white/80 font-medium underline underline-offset-4",
		footerActionText: "!text-white/60",

		identityPreviewText: "!text-white",
		identityPreviewEditButton: "!text-white/80 hover:!text-white",

		formHeaderTitle: "!text-white text-2xl font-bold",
		formHeaderSubtitle: "!text-white/70",

		otpCodeFieldInput:
			"!bg-white/10 !border !border-white/20 !text-white focus:!border-white/40",
		formResendCodeLink: "!text-white/80 hover:!text-white underline",

		alertText: "!text-white",
		alert: "!bg-red-500/20 !border !border-red-500/40 !text-white",
		formFieldErrorText: "!text-red-300",

		alternativeMethodsBlockButton:
			"!border !border-white/20 !bg-white/10 hover:!bg-white/20 !text-white",
		alternativeMethodsBlockButtonText: "!text-white",

		backButton: "!text-white/80 hover:!text-white",
		backRow: "!text-white/60",

		// UserButton (avatar dropdown in the header)
		userButtonTrigger:
			"!rounded-full focus-visible:!outline-none focus-visible:!ring-2 focus-visible:!ring-white/30 focus-visible:!ring-offset-0",
		userButtonPopoverCard:
			"!border !border-white/20 !bg-white/10 backdrop-blur-xl !shadow-2xl !rounded-2xl",
		userButtonPopoverMain: "!bg-transparent",
		userButtonPopoverFooter: "!bg-transparent !border-t !border-white/10",
		userButtonPopoverActions: "!gap-1",
		userButtonPopoverActionButton:
			"!bg-transparent hover:!bg-white/10 !rounded-xl transition-colors",
		userButtonPopoverActionButtonText: "!text-white/90",
		userButtonPopoverActionButtonIcon: "!text-white/70",
		userButtonPopoverActionButton__manageAccount: "hover:!bg-white/10",
		userButtonPopoverActionButton__signOut:
			"hover:!bg-red-500/20 !text-red-200",

		// Manage account modal (UserProfile opened from UserButton)
		modalBackdrop: "!bg-black/70 backdrop-blur-sm",
		modalContent:
			"!border !border-white/20 !bg-white/10 backdrop-blur-xl !shadow-2xl !rounded-2xl",
		navbar: "!bg-transparent !border-r !border-white/10",
		navbarButton:
			"!text-white/80 hover:!text-white hover:!bg-white/10 !rounded-xl",
		pageScrollBox: "!bg-transparent",
		profileSection: "!border !border-white/10 !bg-white/5 !rounded-2xl",
		profileSectionTitle: "!text-white",
		profileSectionContent: "!text-white/80",
	},

	layout: {
		socialButtonsPlacement: "top",
		socialButtonsVariant: "blockButton",
	},
};
