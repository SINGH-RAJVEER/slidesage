import { ActiveGenerationIndicator as IndicatorView } from "@slidesage/ui/components/StatusIndicator/ActiveGenerationIndicator";
import { useLocation, useNavigate } from "react-router-dom";
import { ROUTES } from "./router/paths";

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
		/>
	);
}
