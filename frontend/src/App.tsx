import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import HomePage from "./pages/HomePage";
import GeneratePPTPage from "./pages/GeneratePPTPage";
import PresentationViewer from "./pages/PresentationViewer";
import ProfilePage from "./pages/ProfilePage";
import LoginPage from "./pages/LoginPage";
import ProtectedRoute from "./components/ProtectedRoute";
import { StreamingProvider } from "./contexts/StreamingContext";

export default function App() {
  return (
    <BrowserRouter>
      <StreamingProvider>
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
            path="/presentation"
            element={
              <ProtectedRoute>
                <PresentationViewer />
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </StreamingProvider>
    </BrowserRouter>
  );
}
