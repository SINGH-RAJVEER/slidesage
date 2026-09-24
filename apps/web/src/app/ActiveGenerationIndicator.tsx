import { ActiveGenerationIndicator as IndicatorView } from "@slidesage/ui/components/StatusIndicator/ActiveGenerationIndicator";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "./router/paths";

/** Mounts the floating generation indicator with routing awareness. */
export default function ActiveGenerationIndicator() {
	const navigate = useNavigate();

	return <IndicatorView onOpen={() => navigate(ROUTES.presentations)} />;
}
