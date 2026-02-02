import { createBrowserRouter } from "react-router-dom";
import HomePage from "@/routes/HomePage";
import SignInPage from "@/routes/SignInPage";
import SignUpPage from "@/routes/SignUpPage";
import {
  GeneratePPTPage,
  PresentationViewer,
  PresentationErrorPage,
  PurchaseTokensPage,
  PresentationsGridPage,
} from "@/modules/presentations";
import NotFoundPage from "@/routes/NotFoundPage";
import RouteErrorPage from "@/routes/RouteErrorPage";
import RequireSignedInLayout from "@/router/RequireSignedInLayout";

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
