import { LoadingScreen } from "@slidesage/ui/components/loading-screen";
import type { ComponentType } from "react";
import { createBrowserRouter } from "react-router-dom";
import ForgotPasswordPage from "../../routes/auth/ForgotPasswordPage";
import ResetPasswordPage from "../../routes/auth/ResetPasswordPage";
import SignInPage from "../../routes/auth/SignInPage";
import SignUpPage from "../../routes/auth/SignUpPage";
import VerifyEmailPage from "../../routes/auth/VerifyEmailPage";
import NotFoundPage from "../../routes/NotFoundPage";
import RouteErrorPage from "../../routes/RouteErrorPage";
import ProfilePage from "../../routes/settings/ProfilePage";
import SettingsPage from "../../routes/settings/SettingsPage";
import EntranceRoute from "./EntranceRoute";
import RequireSignedInLayout from "./RequireSignedInLayout";
import RootLayout from "./RootLayout";
import { routeModules } from "./route-modules";

function lazyRoute<T extends { default: ComponentType }>(importer: () => Promise<T>) {
	return async () => {
		const mod = await importer();
		return { Component: mod.default };
	};
}

export const router = createBrowserRouter([
	{
		element: <RootLayout />,
		errorElement: <RouteErrorPage />,
		hydrateFallbackElement: <LoadingScreen label="Loading page" />,
		children: [
			{ index: true, element: <EntranceRoute /> },
			/* the landing page is always public, so a signed-in user can still
			   reach it even when it is not their default page */
			{ path: "landing", lazy: lazyRoute(routeModules.landing) },
			{ path: "sign-in/*", element: <SignInPage /> },
			{ path: "sign-up/*", element: <SignUpPage /> },
			{ path: "sign-up/verify-email", element: <VerifyEmailPage /> },
			{ path: "forgot-password", element: <ForgotPasswordPage /> },
			{ path: "reset-password", element: <ResetPasswordPage /> },
			/* share links open without an account */
			{
				path: "s/:token",
				lazy: lazyRoute(routeModules.shared),
			},
			{
				element: <RequireSignedInLayout />,
				children: [
					{ path: "profile", element: <ProfilePage /> },
					{ path: "settings", element: <SettingsPage /> },
					{ path: "feedback", lazy: lazyRoute(() => import("../../routes/feedback/FeedbackPage")) },
					{
						path: "generate",
						lazy: lazyRoute(routeModules.generate),
					},
					{
						path: "generate/outline",
						lazy: lazyRoute(routeModules.outline),
					},
					{
						path: "generate/research",
						lazy: lazyRoute(routeModules.research),
					},
					{
						path: "marketplace",
						lazy: lazyRoute(routeModules.marketplace),
					},
					{
						path: "marketplace/:marketplaceId/preview",
						lazy: lazyRoute(routeModules.marketplacePreview),
					},
					{
						path: "presentations",
						lazy: lazyRoute(routeModules.presentations),
					},
					{
						path: "presentations/:presentationId",
						lazy: lazyRoute(routeModules.presentation),
					},
					{
						path: "presentation-error",
						lazy: lazyRoute(routeModules.presentationError),
					},
					{
						path: "purchase",
						lazy: lazyRoute(routeModules.purchase),
					},
				],
			},
			{ path: "*", element: <NotFoundPage /> },
		],
	},
]);
