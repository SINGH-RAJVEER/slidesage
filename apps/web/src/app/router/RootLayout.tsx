import { Outlet } from "react-router-dom";
import ActiveGenerationIndicator from "../ActiveGenerationIndicator";
import { HorizonTransitionProvider } from "../transitions/HorizonTransition";

export default function RootLayout() {
	return (
		<HorizonTransitionProvider>
			<Outlet />
			<ActiveGenerationIndicator />
		</HorizonTransitionProvider>
	);
}
