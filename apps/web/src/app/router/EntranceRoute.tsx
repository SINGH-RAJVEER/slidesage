import { LoadingScreen, useAuth } from "@slidesage/ui";
import { hasSignedInBefore } from "@slidesage/ui/lib/session-history";
import { lazy, Suspense } from "react";
import HomePage from "../../routes/presentations/HomePage";

const loadLandingPage = () => import("../../routes/landing/LandingPage");
const LandingPage = lazy(loadLandingPage);

/*
 * The landing page carries a WebGL shader, a star field, and the whole plate
 * catalog, and a signed-in visitor whose default is an app page never sees any
 * of it - so it is split out of the initial bundle rather than shipped to
 * everyone. A browser with no sign-in history is the page's audience, though,
 * and making it wait for a second round trip after the session check would be
 * trading one page's bytes for another's paint. Warming the chunk here puts
 * that fetch alongside the session check instead of after it.
 */
if (typeof window !== "undefined" && !hasSignedInBefore()) void loadLandingPage();

/** Holds the page's own background, so the split never flashes a light frame. */
function LandingFallback() {
	return <div className="h-dvh w-full bg-[hsl(222_27%_12%)]" />;
}

/**
 * The index route.
 *
 * Visitors who are not signed in always see the public landing page. Signed-in
 * visitors go wherever their default-page setting points, which includes
 * staying on the landing page if that is what they chose.
 */
export default function EntranceRoute() {
	const { isSignedIn, loading, user } = useAuth();

	if (loading) {
		return <LoadingScreen label="Loading SlideSage" />;
	}
	if (!isSignedIn || user?.landingPage === "landing") {
		return (
			<Suspense fallback={<LandingFallback />}>
				<LandingPage />
			</Suspense>
		);
	}
	// HomePage forwards to the generate or presentations page.
	return <HomePage />;
}
