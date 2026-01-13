import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { Analytics } from "@vercel/analytics/react";
import HomePage from "./pages/HomePage";
import {
  LoginPage,
  ProtectedRoute,
} from "./features/auth";
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
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <HomePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/generate"
            element={
              <ProtectedRoute>
                <GeneratePPTPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/presentations"
            element={
              <ProtectedRoute>
                <PresentationsGridPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/presentation"
            element={
              <ProtectedRoute>
                <PresentationViewer />
              </ProtectedRoute>
            }
          />
          <Route
            path="/presentation-error"
            element={
              <ProtectedRoute>
                <PresentationErrorPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/purchase"
            element={
              <ProtectedRoute>
                <PurchaseTokensPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </StreamingProvider>
    </BrowserRouter>
  );
}
