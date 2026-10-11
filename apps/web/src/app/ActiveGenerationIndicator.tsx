import { ActiveGenerationIndicator as IndicatorView } from "@slidesage/ui/components/StatusIndicator/ActiveGenerationIndicator";
import { useLocation, useNavigate } from "react-router-dom";
import { prefetchModule } from "./prefetch";
import { ROUTES } from "./router/paths";
import { routeModules } from "./router/route-modules";

/** Mounts the floating generation indicator with routing awareness. */
export default function ActiveGenerationIndicator() {
	const navigate = useNavigate();
	const location = useLocation();
	// The presentation page shows its own progress.
	const onPresentationPage =
		location.pathname.startsWith(`${ROUTES.presentations}/`) &&
		location.pathname !== ROUTES.presentations;

	return (
		<IndicatorView
			hidden={onPresentationPage}
			onOpen={(presentationId) =>
				navigate(presentationId ? ROUTES.presentationById(presentationId) : ROUTES.presentations)
			}
			// A generating deck streams its own progress, so only the page's code
			// is worth loading early.
			onPrefetch={(presentationId) =>
				prefetchModule(presentationId ? routeModules.presentation : routeModules.presentations)
			}
		/>
	);
}
