import { useAuth } from "@slidesage/ui";
import { type HeaderRoutes, Header as HeaderView } from "@slidesage/ui/components/Header";
import { useLocation, useNavigate } from "react-router-dom";
import { PrefetchLink } from "./PrefetchLink";
import { ROUTES } from "./router/paths";
import { useRoutePrefetch } from "./useRoutePrefetch";

const HEADER_ROUTES: HeaderRoutes = {
	home: ROUTES.home,
	landing: ROUTES.landing,
	generate: ROUTES.generate,
	research: ROUTES.research,
	presentations: ROUTES.presentations,
	marketplace: ROUTES.marketplace,
	purchase: ROUTES.purchase,
	profile: ROUTES.profile,
	settings: ROUTES.settings,
	feedback: ROUTES.feedback,
	auth: [ROUTES.signIn, ROUTES.signUp, ROUTES.forgotPassword, ROUTES.resetPassword],
};

export default function Header({ sticky = false }: { sticky?: boolean }) {
	const { user, signOut } = useAuth();
	const location = useLocation();
	const navigate = useNavigate();
	const prefetchPath = useRoutePrefetch();

	return (
		<HeaderView
			currentPath={location.pathname}
			routes={HEADER_ROUTES}
			LinkComponent={PrefetchLink}
			user={user}
			sticky={sticky}
			onNavigate={navigate}
			onPrefetch={prefetchPath}
			onSignOut={signOut}
		/>
	);
}
