import { Outlet } from "react-router-dom";
import ActiveGenerationIndicator from "../ActiveGenerationIndicator";

export default function RootLayout() {
	return (
		<>
			<Outlet />
			<ActiveGenerationIndicator />
		</>
	);
}
