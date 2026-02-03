import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import { Spinner } from "@/components/ui/spinner";
import { ROUTES } from "@/router/paths";

const API_URL = import.meta.env.VITE_API_URL;

export default function HomePage() {
  const [loading, setLoading] = useState(true);
  const [hasPresentations, setHasPresentations] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    checkPresentations();
  }, []);

  useEffect(() => {
    if (loading) return;
    navigate(hasPresentations ? ROUTES.presentations : ROUTES.generate, {
      replace: true,
    });
  }, [loading, hasPresentations, navigate]);

  const checkPresentations = async () => {
    try {
      const response = await fetch(`${API_URL}/api/presentations`, {
        credentials: "include",
      });

      if (response.status === 401) {
        // If unauthorized, assume no presentations available (or let ProtectedRoute handle redirect if needed)
        // But for HomePage we might want to show GeneratePPTPage anyway
        setHasPresentations(false);
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
          <Spinner className="h-12 w-12" />
        </div>
      </div>
    );
  }

  // Navigation effect will replace this route with the target page.
  return null;
}
