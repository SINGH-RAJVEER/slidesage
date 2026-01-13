import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { authService } from "@/features/auth";
import {
  GeneratePPTPage,
  PresentationsGridPage,
} from "@/features/presentations";
import Header from "@/components/Header";

const API_URL = import.meta.env.VITE_API_URL;

export default function HomePage() {
  const [loading, setLoading] = useState(true);
  const [hasPresentations, setHasPresentations] = useState(false);

  useEffect(() => {
    checkPresentations();
  }, []);

  const checkPresentations = async () => {
    try {
      const headers = authService.getAuthHeaders();
      const response = await fetch(`${API_URL}/api/presentations`, {
        headers,
      });

      if (response.status === 401) {
        const refreshed = await authService.refreshToken();
        if (refreshed) {
          const newHeaders = authService.getAuthHeaders();
          const retryResponse = await fetch(`${API_URL}/api/presentations`, {
            headers: newHeaders,
          });

          if (retryResponse.ok) {
            const retryResult = await retryResponse.json();
            setHasPresentations(
              retryResult.success && retryResult.presentations.length > 0
            );
          }
        }
        return;
      }

      const result = await response.json();
      setHasPresentations(result.success && result.presentations.length > 0);
    } catch (err) {
      console.error("Error checking presentations:", err);
      // If there's an error, default to showing the generate page
      setHasPresentations(false);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        <Header />
        <div className="p-4 md:p-8 flex items-center justify-center min-h-[calc(100vh-64px)]">
          <Loader2 className="h-12 w-12 animate-spin text-white" />
        </div>
      </div>
    );
  }

  // If user has presentations, show the grid; otherwise show the generate page
  return hasPresentations ? <PresentationsGridPage /> : <GeneratePPTPage />;
}
