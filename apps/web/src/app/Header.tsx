import { useAuth } from "@slidesage/ui";
import {
	type HeaderLinkProps,
	type HeaderRoutes,
	Header as HeaderView,
} from "@slidesage/ui/components/Header";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ROUTES } from "./router/paths";

const HEADER_ROUTES: HeaderRoutes = {
	home: ROUTES.home,
	landing: ROUTES.landing,
	generate: ROUTES.generate,
	research: ROUTES.research,
	presentations: ROUTES.presentations,
	purchase: ROUTES.purchase,
	profile: ROUTES.profile,
	settings: ROUTES.settings,
	auth: [ROUTES.signIn, ROUTES.signUp, ROUTES.forgotPassword, ROUTES.resetPassword],
};

function NavigationLink(props: HeaderLinkProps) {
	const { pathname } = useLocation();
	return (
		<>
			<Link {...props} />
			{props.to === ROUTES.presentations && (
				<Link
					to={ROUTES.marketplace}
					aria-current={pathname.startsWith(ROUTES.marketplace) ? "page" : undefined}
					className={`flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors md:min-h-0 md:px-4 md:py-2.5 md:text-base ${
						pathname.startsWith(ROUTES.marketplace)
							? "bg-white/10 text-white"
							: "text-white/70 hover:bg-white/5 hover:text-white"
					}`}
				>
					Templates
				</Link>
			)}
		</>
	);
}

export default function Header({ sticky = false }: { sticky?: boolean }) {
	const { user, signOut } = useAuth();
	const location = useLocation();
	const navigate = useNavigate();

	return (
		<HeaderView
			currentPath={location.pathname}
			routes={HEADER_ROUTES}
			LinkComponent={NavigationLink}
			user={user}
			sticky={sticky}
			onNavigate={navigate}
			onSignOut={signOut}
		/>
	);
}
