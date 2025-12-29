import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { authService } from "@/services/authService";
import Header from "@/components/Header";
import {
  PresentationCard,
  GridSizeControl,
  CreatePresentationButton,
} from "@/components/PresentationsGridPage";

const API_URL = import.meta.env.VITE_API_URL;

interface Presentation {
  id: number;
  title: string;
  prompt: string;
  created_at: string;
  updated_at: string;
}

export default function PresentationsGridPage() {
  const [presentations, setPresentations] = useState<Presentation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [gridSize, setGridSize] = useState<2 | 3 | 4>(() => {
    const saved = localStorage.getItem("gridSize");
    return saved ? (parseInt(saved) as 2 | 3 | 4) : 3;
  });
  const navigate = useNavigate();

  useEffect(() => {
    fetchPresentations();
  }, []);

  useEffect(() => {
    localStorage.setItem("gridSize", gridSize.toString());
  }, [gridSize]);

  const fetchPresentations = async () => {
    try {
      setLoading(true);
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

          if (!retryResponse.ok) {
            setError("Authentication failed. Please log in again.");
            return;
          }

          const retryResult = await retryResponse.json();
          if (retryResult.success) {
            setPresentations(retryResult.presentations);
          } else {
            setError(retryResult.error || "Failed to fetch presentations");
          }
          return;
        } else {
          setError("Session expired. Please log in again.");
          return;
        }
      }

      const result = await response.json();

      if (result.success) {
        setPresentations(result.presentations);
      } else {
        setError(result.error || "Failed to fetch presentations");
      }
    } catch (err) {
      setError(`Error: ${err instanceof Error ? err.message : err}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePresentationClick = async (presentationId: number) => {
    try {
      const headers = authService.getAuthHeaders();
      const response = await fetch(
        `${API_URL}/api/presentations/${presentationId}`,
        { headers }
      );

      if (response.status === 401) {
        const refreshed = await authService.refreshToken();
        if (!refreshed) {
          setError("Session expired. Please log in again.");
          return;
        }

        const newHeaders = authService.getAuthHeaders();
        const retryResponse = await fetch(
          `${API_URL}/api/presentations/${presentationId}`,
          { headers: newHeaders }
        );

        if (!retryResponse.ok) {
          setError("Failed to load presentation");
          return;
        }

        const retryResult = await retryResponse.json();
        if (retryResult.success && retryResult.presentation) {
          navigate("/presentation", {
            state: {
              presentation: retryResult.presentation.slides_data,
              presentationId: retryResult.presentation.id,
            },
          });
        }
        return;
      }

      const result = await response.json();

      if (result.success && result.presentation) {
        navigate("/presentation", {
          state: {
            presentation: result.presentation.slides_data,
            presentationId: result.presentation.id,
          },
        });
      } else {
        setError(result.error || "Failed to load presentation");
      }
    } catch (err) {
      setError(`Error: ${err instanceof Error ? err.message : err}`);
    }
  };

  const handleDeletePresentation = async (
    e: React.MouseEvent,
    presentationId: number
  ) => {
    e.stopPropagation();

    if (!confirm("Are you sure you want to delete this presentation?")) {
      return;
    }

    try {
      setDeletingId(presentationId);
      const headers = authService.getAuthHeaders();
      const response = await fetch(
        `${API_URL}/api/presentations/${presentationId}`,
        {
          method: "DELETE",
          headers,
        }
      );

      if (response.status === 401) {
        const refreshed = await authService.refreshToken();
        if (!refreshed) {
          setError("Session expired. Please log in again.");
          return;
        }

        const newHeaders = authService.getAuthHeaders();
        const retryResponse = await fetch(
          `${API_URL}/api/presentations/${presentationId}`,
          {
            method: "DELETE",
            headers: newHeaders,
          }
        );

        if (!retryResponse.ok) {
          setError("Failed to delete presentation");
          return;
        }

        const retryResult = await retryResponse.json();
        if (retryResult.success) {
          setPresentations(
            presentations.filter((p) => p.id !== presentationId)
          );
        }
        return;
      }

      const result = await response.json();

      if (result.success) {
        setPresentations(presentations.filter((p) => p.id !== presentationId));
      } else {
        setError(result.error || "Failed to delete presentation");
      }
    } catch (err) {
      setError(`Error: ${err instanceof Error ? err.message : err}`);
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <Header />
      <div className="p-4 md:p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-4xl font-bold text-white flex items-center gap-3">
              Generated Presentations
            </h1>
            <GridSizeControl
              gridSize={gridSize}
              onGridSizeChange={setGridSize}
            />
          </div>

          {error && (
            <Alert
              variant="destructive"
              className="mb-6 bg-red-500/20 border-red-500/50 text-white"
            >
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div
            className={`grid grid-cols-1 ${
              gridSize === 2
                ? "md:grid-cols-2"
                : gridSize === 3
                ? "md:grid-cols-2 lg:grid-cols-3"
                : "md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            } gap-6`}
          >
            {presentations.map((presentation) => (
              <PresentationCard
                key={presentation.id}
                presentation={presentation}
                isDeleting={deletingId === presentation.id}
                onCardClick={handlePresentationClick}
                onDelete={handleDeletePresentation}
                formatDate={formatDate}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Floating Add Button */}
      <CreatePresentationButton onCreateClick={() => navigate("/generate")} />
    </div>
  );
}
