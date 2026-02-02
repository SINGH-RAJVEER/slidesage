import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { Analytics } from "@vercel/analytics/react";
import { SignedIn, SignedOut } from "@clerk/clerk-react";
import HomePage from "./pages/HomePage";
import SignInPage from "./pages/SignInPage";
import SignUpPage from "./pages/SignUpPage";
import {
  GeneratePPTPage,
  PresentationViewer,
  PresentationErrorPage,
  PurchaseTokensPage,
  PresentationsGridPage,
  StreamingProvider,
} from "./features/presentations";
import { ProfilePage } from "./features/profile";

export default function App() {
  return (
    <BrowserRouter>
      <StreamingProvider>
        <SpeedInsights />
        <Analytics />
        <Routes>
          <Route path="/sign-in/*" element={<SignInPage />} />
          <Route path="/sign-up/*" element={<SignUpPage />} />
          <Route
            path="/"
            element={
              <>
                <SignedIn>
                  <HomePage />
                </SignedIn>
                <SignedOut>
                  <Navigate to="/sign-in" replace />
                </SignedOut>
              </>
            }
          />
          <Route
            path="/generate"
            element={
              <>
                <SignedIn>
                  <GeneratePPTPage />
                </SignedIn>
                <SignedOut>
                  <Navigate to="/sign-in" replace />
                </SignedOut>
              </>
            }
          />
          <Route
            path="/presentations"
            element={
              <>
                <SignedIn>
                  <PresentationsGridPage />
                </SignedIn>
                <SignedOut>
                  <Navigate to="/sign-in" replace />
                </SignedOut>
              </>
            }
          />
          <Route
            path="/presentation"
            element={
              <>
                <SignedIn>
                  <PresentationViewer />
                </SignedIn>
                <SignedOut>
                  <Navigate to="/sign-in" replace />
                </SignedOut>
              </>
            }
          />
          <Route
            path="/presentation-error"
            element={
              <>
                <SignedIn>
                  <PresentationErrorPage />
                </SignedIn>
                <SignedOut>
                  <Navigate to="/sign-in" replace />
                </SignedOut>
              </>
            }
          />
          <Route
            path="/profile"
            element={
              <>
                <SignedIn>
                  <ProfilePage />
                </SignedIn>
                <SignedOut>
                  <Navigate to="/sign-in" replace />
                </SignedOut>
              </>
            }
          />
          <Route
            path="/purchase"
            element={
              <>
                <SignedIn>
                  <PurchaseTokensPage />
                </SignedIn>
                <SignedOut>
                  <Navigate to="/sign-in" replace />
                </SignedOut>
              </>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </StreamingProvider>
    </BrowserRouter>
  );
}
