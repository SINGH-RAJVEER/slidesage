import { SignUp } from "@clerk/clerk-react";
import { useSearchParams } from "react-router-dom";
import Header from "@/components/Header";
import { clerkAppearance } from "@/lib/clerk-appearance";

function sanitizeRedirectPath(value: string | null) {
	if (!value) return "/";
	if (!value.startsWith("/")) return "/";
	if (value.startsWith("//")) return "/";
	return value;
}

export default function SignUpPage() {
	const [searchParams] = useSearchParams();
	const redirectTo = sanitizeRedirectPath(searchParams.get("redirect_url"));

	return (
		<div className="min-h-screen bg-transparent flex flex-col">
			<Header />
			<div className="flex-1 flex items-center justify-center px-4 md:px-8">
				<div className="max-w-5xl">
					<SignUp
						appearance={clerkAppearance}
						routing="path"
						path="/sign-up"
						signInUrl="/sign-in"
						afterSignUpUrl={redirectTo}
					/>
				</div>
			</div>
		</div>
	);
}
