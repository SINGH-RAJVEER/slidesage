import { createBrowserRouter } from "react-router-dom";
import {
	GeneratePPTPage,
	PresentationErrorPage,
	PresentationsGridPage,
	PresentationViewer,
	PurchaseTokensPage,
} from "@/modules/presentations";
import RequireSignedInLayout from "@/router/RequireSignedInLayout";
import HomePage from "@/routes/HomePage";
import NotFoundPage from "@/routes/NotFoundPage";
import RouteErrorPage from "@/routes/RouteErrorPage";
import SignInPage from "@/routes/SignInPage";
import SignUpPage from "@/routes/SignUpPage";

export const router = createBrowserRouter([
	{
		errorElement: <RouteErrorPage />,
		children: [
			{ path: "/sign-in/*", element: <SignInPage /> },
			{ path: "/sign-up/*", element: <SignUpPage /> },
			{
				element: <RequireSignedInLayout />,
				children: [
					{ path: "/", element: <HomePage /> },
					{ path: "/generate", element: <GeneratePPTPage /> },
					{ path: "/presentations", element: <PresentationsGridPage /> },
					{ path: "/presentation", element: <PresentationViewer /> },
					{ path: "/presentation-error", element: <PresentationErrorPage /> },
					{ path: "/purchase", element: <PurchaseTokensPage /> },
				],
			},
			{ path: "*", element: <NotFoundPage /> },
		],
	},
]);
