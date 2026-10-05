import { useAuth } from "@slidesage/ui";
import { type HeaderRoutes, Header as HeaderView } from "@slidesage/ui/components/Header";
import { useLocation, useNavigate } from "react-router-dom";
import { PrefetchLink } from "./PrefetchLink";
import { prefetchRoute } from "./prefetch";
import { ROUTES } from "./router/paths";

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
	auth: [ROUTES.signIn, ROUTES.signUp, ROUTES.forgotPassword, ROUTES.resetPassword],
};

export default function Header({ sticky = false }: { sticky?: boolean }) {
	const { user, signOut } = useAuth();
	const location = useLocation();
	const navigate = useNavigate();

	return (
		<HeaderView
			currentPath={location.pathname}
			routes={HEADER_ROUTES}
			LinkComponent={PrefetchLink}
			user={user}
			sticky={sticky}
			onNavigate={navigate}
			onPrefetch={(path) => {
				if (path !== location.pathname) prefetchRoute(path, { signedIn: Boolean(user) });
			}}
			onSignOut={signOut}
		/>
	);
}
