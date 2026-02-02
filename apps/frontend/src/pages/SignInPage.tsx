import { SignIn } from "@clerk/clerk-react";
import Header from "@/components/Header";

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex flex-col">
      <Header />
      <div className="flex-1 flex items-center justify-center px-4 md:px-8">
        <div className="max-w-5xl">
          <SignIn
            appearance={{
              elements: {
                rootBox: "mx-auto",
                card: "shadow-2xl border border-white/20 bg-white/10 backdrop-blur-md",
                headerTitle: "text-white text-4xl font-bold",
                headerSubtitle: "text-white/80 text-lg",
                socialButtonsBlockButton:
                  "bg-white hover:bg-gray-50 text-gray-900 border border-gray-300 h-12 text-base font-medium transition-all duration-200",
                socialButtonsBlockButtonText: "font-medium text-gray-900",
                socialButtonsIconButton:
                  "border border-white/20 bg-white/10 hover:bg-white/20",
                dividerLine: "bg-white/40",
                dividerText: "text-white/60 text-sm",
                formFieldLabel: "text-white/80 text-base font-medium",
                formFieldInput:
                  "bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:border-white/40 focus:ring-white/20 h-12 text-base",
                formFieldInputShowPasswordButton:
                  "text-white/60 hover:text-white",
                formButtonPrimary:
                  "bg-white/10 hover:bg-white/20 backdrop-blur-lg border border-white/30 text-white shadow-[0_8px_32px_0_rgba(255,255,255,0.1)] hover:shadow-[0_8px_32px_0_rgba(255,255,255,0.2)] h-12 text-base font-semibold transition-all duration-300",
                footerActionLink:
                  "text-white hover:text-white/80 font-medium underline",
                footerActionText: "text-white/60",
                identityPreviewText: "text-white",
                identityPreviewEditButton: "text-white/80 hover:text-white",
                formHeaderTitle: "text-white text-2xl font-bold",
                formHeaderSubtitle: "text-white/70",
                otpCodeFieldInput:
                  "bg-white/10 border-white/20 text-white focus:border-white/40",
                formResendCodeLink: "text-white/80 hover:text-white underline",
                alertText: "text-white",
                alert: "bg-red-500/20 border-red-500/50 text-white",
                formFieldErrorText: "text-red-300",
                identifierInputRow: "text-white",
                alternativeMethodsBlockButton:
                  "border border-white/20 bg-white/10 hover:bg-white/20 text-white",
                alternativeMethodsBlockButtonText: "text-white",
                backButton: "text-white/80 hover:text-white",
                backRow: "text-white/60",
                cardBox: "shadow-2xl",
              },
              layout: {
                socialButtonsPlacement: "top",
                socialButtonsVariant: "blockButton",
              },
            }}
            routing="path"
            path="/sign-in"
            signUpUrl="/sign-up"
            afterSignInUrl="/"
          />
        </div>
      </div>
    </div>
  );
}
