import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import {
	CreatePresentationButton,
	GridSizeControl,
	PresentationCard,
} from "@/components/presentations/PresentationsGridPage";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

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
	const [presentationToDelete, setPresentationToDelete] = useState<
		number | null
	>(null);
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
			const response = await fetch(`${API_URL}/api/presentations`, {
				credentials: "include",
			});

			if (response.status === 401) {
				setError("Authentication failed. Please log in again.");
				return;
			}

			const result = await response.json();

			// New API format: {presentations: [...]} or {error: {message: "..."}}
			if (result.error) {
				setError(
					typeof result.error === "object"
						? result.error.message
						: result.error,
				);
			} else {
				setPresentations(result.presentations || []);
			}
		} catch (err) {
			setError(`Error: ${err instanceof Error ? err.message : err}`);
		} finally {
			setLoading(false);
		}
	};

	const handlePresentationClick = async (presentationId: number) => {
		try {
			const response = await fetch(
				`${API_URL}/api/presentations/${presentationId}`,
				{ credentials: "include" },
			);

			if (response.status === 401) {
				setError("Session expired. Please log in again.");
				return;
			}

			const result = await response.json();

			// New API format: {presentation: {...}} or {error: {message: "..."}}
			if (result.error) {
				setError(
					typeof result.error === "object"
						? result.error.message
						: result.error,
				);
			} else if (result.presentation) {
				navigate("/presentation", {
					state: {
						presentation:
							result.presentation.slides_data || result.presentation.slides,
						presentationId: result.presentation.id,
					},
				});
			} else {
				setError("Failed to load presentation");
			}
		} catch (err) {
			setError(`Error: ${err instanceof Error ? err.message : err}`);
		}
	};

	const handleDeletePresentation = (
		e: React.MouseEvent,
		presentationId: number,
	) => {
		e.stopPropagation();
		setPresentationToDelete(presentationId);
	};

	const executeDelete = async () => {
		if (!presentationToDelete) return;
		const presentationId = presentationToDelete;

		try {
			setDeletingId(presentationId);
			const response = await fetch(
				`${API_URL}/api/presentations/${presentationId}`,
				{
					method: "DELETE",
					credentials: "include",
				},
			);

			if (response.status === 401) {
				setError("Session expired. Please log in again.");
				return;
			}

			const result = await response.json();

			// New API format: {message: "..."} or {error: {message: "..."}}
			if (result.error) {
				setError(
					typeof result.error === "object"
						? result.error.message
						: result.error,
				);
			} else {
				setPresentations(presentations.filter((p) => p.id !== presentationId));
			}
		} catch (err) {
			setError(`Error: ${err instanceof Error ? err.message : err}`);
		} finally {
			setDeletingId(null);
			setPresentationToDelete(null);
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
						{presentations.length === 0 ? (
							<div className="col-span-full flex flex-col items-center justify-center py-96 text-center">
								<h2 className="text-3xl text-white mb-2">
									No Presentations Generated Yet
								</h2>
							</div>
						) : (
							presentations.map((presentation) => (
								<PresentationCard
									key={presentation.id}
									presentation={presentation}
									isDeleting={deletingId === presentation.id}
									onCardClick={handlePresentationClick}
									onDelete={handleDeletePresentation}
									formatDate={formatDate}
								/>
							))
						)}
					</div>
				</div>
			</div>

			{/* Floating Add Button */}
			<CreatePresentationButton onCreateClick={() => navigate("/generate")} />

			<Dialog
				open={!!presentationToDelete}
				onOpenChange={(open) => !open && setPresentationToDelete(null)}
			>
				<DialogContent className="bg-white/10 backdrop-blur-md border-white/20 text-white shadow-2xl">
					<DialogHeader>
						<DialogTitle>Delete Presentation</DialogTitle>
						<DialogDescription className="text-white/70">
							Are you sure you want to delete this presentation? This action
							cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="ghost"
							onClick={() => setPresentationToDelete(null)}
							className="text-white hover:bg-white/10 hover:text-white"
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={executeDelete}
							disabled={deletingId !== null}
							className="bg-red-500 hover:bg-red-600 text-white"
						>
							{deletingId !== null ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Deleting...
								</>
							) : (
								"Delete"
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
