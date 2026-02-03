import type { ComponentType } from "react";
import { createBrowserRouter } from "react-router-dom";
import RequireSignedInLayout from "@/router/RequireSignedInLayout";
import HomePage from "@/routes/HomePage";
import NotFoundPage from "@/routes/NotFoundPage";
import RouteErrorPage from "@/routes/RouteErrorPage";
import SignInPage from "@/routes/SignInPage";
import SignUpPage from "@/routes/SignUpPage";

function lazyRoute<T extends { default: ComponentType }>(
  importer: () => Promise<T>,
) {
  return async () => {
    const mod = await importer();
    return { Component: mod.default };
  };
}

export const router = createBrowserRouter([
  {
    errorElement: <RouteErrorPage />,
    children: [
      { path: "sign-in/*", element: <SignInPage /> },
      { path: "sign-up/*", element: <SignUpPage /> },
      {
        element: <RequireSignedInLayout />,
        children: [
          { index: true, element: <HomePage /> },
          {
            path: "generate",
            lazy: lazyRoute(() => import("@/modules/pages/GeneratePPTPage")),
          },
          {
            path: "presentations",
            lazy: lazyRoute(
              () => import("@/modules/pages/PresentationsGridPage"),
            ),
          },
          {
            path: "presentations/:presentationId",
            lazy: lazyRoute(() => import("@/modules/pages/PresentationViewer")),
          },
          // Streaming / legacy route (kept because generation navigates here before an id exists)
          {
            path: "presentation",
            lazy: lazyRoute(() => import("@/modules/pages/PresentationViewer")),
          },
          {
            path: "presentation-error",
            lazy: lazyRoute(
              () => import("@/modules/pages/PresentationErrorPage"),
            ),
          },
          {
            path: "purchase",
            lazy: lazyRoute(() => import("@/modules/pages/PurchaseTokensPage")),
          },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
