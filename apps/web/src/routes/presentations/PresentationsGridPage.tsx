import type { ApiErrorResponse, PresentationSummary } from "@slidesage/types";
import { Button } from "@slidesage/ui/components/button";
import { FloatingNotice, NOTICE_TTL_MS } from "@slidesage/ui/components/FloatingNotice";
import { GridSizeControl, PresentationCard } from "@slidesage/ui/components/Presentations";
import { SearchBar } from "@slidesage/ui/components/SearchBar";
import { ThinkingOrb } from "@slidesage/ui/components/thinking-orb";
import { API_URL, readJsonResponse } from "@slidesage/ui/lib/api";
import {
	PRESENTATIONS_UPDATED_EVENT,
	type PresentationUpdatedDetail,
} from "@slidesage/ui/lib/presentation-events";
import { getPresentationRetryDestination } from "@slidesage/ui/lib/presentation-retry";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Header from "../../app/Header";
import { ROUTES } from "../../app/router/paths";
import { useHorizonPageReady } from "../../app/transitions/HorizonTransition";
import type { LibraryNotice } from "./PresentationPage";
import {
	evictPresentation,
	fetchPresentationsPage,
	PRESENTATIONS_PAGE_SIZE,
	prefetchPresentation,
	prefetchPresentationDetail,
	takeLibrary,
} from "./presentation-data";

interface PaginationState {
	total: number;
	limit: number;
	offset: number;
	hasMore: boolean;
}

interface FetchPresentationsOptions {
	background?: boolean;
	append?: boolean;
	offset?: number;
}

/** A presentation removed from the grid whose deletion can still be undone. */
interface PendingDelete {
	presentation: PresentationSummary;
	index: number;
}

function parseDateRange(value: string) {
	const trimmed = value.trim();
	if (!trimmed) return null;

	const fullDateMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (fullDateMatch) {
		const year = Number(fullDateMatch[1]);
		const month = Number(fullDateMatch[2]);
		const day = Number(fullDateMatch[3]);
		const start = new Date(year, month - 1, day, 0, 0, 0, 0);
		const end = new Date(year, month - 1, day, 23, 59, 59, 999);
		return { start, end };
	}

	const monthMatch = trimmed.match(/^(\d{4})-(\d{2})$/);
	if (monthMatch) {
		const year = Number(monthMatch[1]);
		const month = Number(monthMatch[2]);
		const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
		const end = new Date(year, month, 0, 23, 59, 59, 999);
		return { start, end };
	}

	const yearMatch = trimmed.match(/^(\d{4})$/);
	if (yearMatch) {
		const year = Number(yearMatch[1]);
		const start = new Date(year, 0, 1, 0, 0, 0, 0);
		const end = new Date(year, 11, 31, 23, 59, 59, 999);
		return { start, end };
	}

	const parsed = new Date(trimmed);
	if (!Number.isNaN(parsed.getTime())) {
		const start = new Date(parsed);
		start.setHours(0, 0, 0, 0);
		const end = new Date(parsed);
		end.setHours(23, 59, 59, 999);
		return { start, end };
	}

	return null;
}

export default function PresentationsGridPage() {
	const [presentations, setPresentations] = useState<PresentationSummary[]>([]);
	const [searchQuery, setSearchQuery] = useState("");
	const [loading, setLoading] = useState(true);
	useHorizonPageReady(!loading);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState("");
	const [openingId, setOpeningId] = useState<string | null>(null);
	const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
	const pendingDeleteRef = useRef<PendingDelete | null>(null);
	const pendingDeleteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	// Presentations deleted in this session, kept out of refetched pages while
	// the deletion is pending or in flight.
	const deletedIds = useRef(new Set<string>());
	const [pagination, setPagination] = useState<PaginationState>({
		total: 0,
		limit: PRESENTATIONS_PAGE_SIZE,
		offset: 0,
		hasMore: false,
	});
	const [gridSize, setGridSize] = useState<2 | 3 | 4>(() => {
		const saved = localStorage.getItem("gridSize");
		return saved ? (parseInt(saved, 10) as 2 | 3 | 4) : 3;
	});
	const navigate = useNavigate();
	const location = useLocation();

	// A presentation that could not be opened sends its reason here. It is
	// shown once, so a reload of the library does not repeat it.
	const [notice, setNotice] = useState(
		() => (location.state as LibraryNotice | null)?.notice ?? null,
	);
	useEffect(() => {
		if ((location.state as LibraryNotice | null)?.notice) {
			navigate(location.pathname, { replace: true, state: null });
		}
	}, [location.state, location.pathname, navigate]);

	const filteredPresentations = useMemo(() => {
		const query = searchQuery.trim();
		if (!query) return presentations;

		const dateRange = parseDateRange(query);
		if (dateRange) {
			return presentations.filter((presentation) => {
				const createdDate = new Date(presentation.created_at);
				return createdDate >= dateRange.start && createdDate <= dateRange.end;
			});
		}

		const queryLower = query.toLowerCase();
		return presentations.filter(
			(presentation) =>
				presentation.title.toLowerCase().includes(queryLower) ||
				presentation.prompt.toLowerCase().includes(queryLower),
		);
	}, [presentations, searchQuery]);

	const fetchPresentations = useCallback(
		async ({ background = false, append = false, offset = 0 }: FetchPresentationsOptions = {}) => {
			try {
				if (append) setLoadingMore(true);
				else if (!background) setLoading(true);
				setError("");
				// Opening the library may use the first page that hovering its link
				// prefetched; refreshes and further pages always ask the server.
				const page =
					background || append ? await fetchPresentationsPage(offset) : await takeLibrary();

				if (!page.ok && page.status === 401) {
					setError("Authentication failed. Please log in again.");
					return;
				}

				if (!page.ok) {
					setError(page.message || `Failed to load presentations (${page.status}).`);
					return;
				}

				const result = page.data;
				const presentationsList = result.presentations.filter(
					(presentation) => !deletedIds.current.has(presentation.id),
				);
				setPresentations((current) => {
					if (!append) return presentationsList;

					const existingIds = new Set(current.map((presentation) => presentation.id));
					return [
						...current,
						...presentationsList.filter((presentation) => !existingIds.has(presentation.id)),
					];
				});
				setPagination({
					total: result.total,
					limit: result.limit,
					offset: result.offset,
					hasMore: result.has_more,
				});
			} catch (err) {
				setError(`Error: ${err instanceof Error ? err.message : err}`);
			} finally {
				if (append) setLoadingMore(false);
				else if (!background) setLoading(false);
			}
		},
		[],
	);

	useEffect(() => {
		void fetchPresentations();
	}, [fetchPresentations]);

	useEffect(() => {
		const handlePresentationsUpdated = (event: Event) => {
			// A card hovered while its deck was generating holds a stale status.
			const { presentationId } = (event as CustomEvent<PresentationUpdatedDetail>).detail;
			evictPresentation(presentationId);
			void fetchPresentations({ background: true });
		};

		window.addEventListener(PRESENTATIONS_UPDATED_EVENT, handlePresentationsUpdated);
		return () => {
			window.removeEventListener(PRESENTATIONS_UPDATED_EVENT, handlePresentationsUpdated);
		};
	}, [fetchPresentations]);

	useEffect(() => {
		localStorage.setItem("gridSize", gridSize.toString());
	}, [gridSize]);

	const handlePresentationClick = async (presentationId: string) => {
		try {
			setOpeningId(presentationId);
			// Usually loaded already by hovering the card, and kept for the
			// presentation page so it does not ask again.
			const detail = await prefetchPresentationDetail(presentationId);

			if (!detail.ok) {
				// A refusal is not kept, so clicking again asks the server again.
				evictPresentation(presentationId);
				setError(
					detail.status === 401
						? "Session expired. Please log in again."
						: detail.message || `Failed to open presentation (${detail.status}).`,
				);
				return;
			}

			const { presentation } = detail.data;
			const retryDestination = getPresentationRetryDestination(
				presentation.slides_data,
				presentation.id,
			);

			if (retryDestination) {
				// Only the presentation page reads the kept detail, and a retry
				// is about to change it.
				evictPresentation(presentationId);
				navigate(retryDestination.to, { state: retryDestination.state });
				return;
			}

			navigate(ROUTES.presentationById(presentation.id));
		} catch (err) {
			setError(`Error: ${err instanceof Error ? err.message : err}`);
		} finally {
			setOpeningId(null);
		}
	};

	const restorePresentation = useCallback(({ presentation, index }: PendingDelete) => {
		deletedIds.current.delete(presentation.id);
		setPresentations((current) =>
			current.some((item) => item.id === presentation.id)
				? current
				: [...current.slice(0, index), presentation, ...current.slice(index)],
		);
		setPagination((current) => ({ ...current, total: current.total + 1 }));
	}, []);

	// The server deletes for good, so the request is sent only once the Undo
	// window has passed. A failed request puts the presentation back.
	const sendDelete = useCallback(
		async (entry: PendingDelete, keepalive = false) => {
			try {
				const response = await fetch(`${API_URL}/presentations/${entry.presentation.id}`, {
					method: "DELETE",
					credentials: "include",
					keepalive,
				});

				if (response.status === 401) {
					restorePresentation(entry);
					setError("Session expired. Please log in again.");
					return;
				}

				const result =
					response.status === 204 ? null : await readJsonResponse<ApiErrorResponse>(response);

				if (!response.ok) {
					restorePresentation(entry);
					setError(result?.error.message || `Failed to delete presentation (${response.status}).`);
				}
			} catch (err) {
				restorePresentation(entry);
				setError(`Error: ${err instanceof Error ? err.message : err}`);
			}
		},
		[restorePresentation],
	);

	/** Ends the Undo window, returning the deletion it was holding back. */
	const takePendingDelete = useCallback(() => {
		clearTimeout(pendingDeleteTimer.current);
		const entry = pendingDeleteRef.current;
		pendingDeleteRef.current = null;
		setPendingDelete(null);
		return entry;
	}, []);

	const commitPendingDelete = useCallback(() => {
		const entry = takePendingDelete();
		if (entry) void sendDelete(entry);
	}, [takePendingDelete, sendDelete]);

	const undoDelete = () => {
		const entry = takePendingDelete();
		if (entry) restorePresentation(entry);
	};

	// Leaving the page or closing the tab inside the Undo window still deletes.
	useEffect(() => {
		// Only a closing tab needs keepalive to outlive the document.
		const leave = (keepalive: boolean) => {
			clearTimeout(pendingDeleteTimer.current);
			const entry = pendingDeleteRef.current;
			pendingDeleteRef.current = null;
			if (entry) void sendDelete(entry, keepalive);
		};
		const closeTab = () => leave(true);
		window.addEventListener("pagehide", closeTab);
		return () => {
			window.removeEventListener("pagehide", closeTab);
			leave(false);
		};
	}, [sendDelete]);

	// One click hides the presentation and offers Undo; a second deletion
	// commits the first straight away.
	const handleDeletePresentation = (e: React.MouseEvent, presentationId: string) => {
		e.stopPropagation();
		const index = presentations.findIndex((presentation) => presentation.id === presentationId);
		const presentation = presentations[index];
		if (!presentation) return;

		commitPendingDelete();
		// The new deletion replaces any message on the notice so Undo shows.
		setError("");
		setNotice(null);
		evictPresentation(presentationId);
		const entry = { presentation, index };
		deletedIds.current.add(presentationId);
		pendingDeleteRef.current = entry;
		setPendingDelete(entry);
		setPresentations((current) => current.filter((item) => item.id !== presentationId));
		setPagination((current) => ({ ...current, total: Math.max(0, current.total - 1) }));
		pendingDeleteTimer.current = setTimeout(commitPendingDelete, NOTICE_TTL_MS);
	};

	const formatDate = (dateString: string) => {
		const date = new Date(dateString);
		return date.toLocaleDateString("en-US", {
			year: "numeric",
			month: "short",
			day: "numeric",
		});
	};

	return (
		<div className="flex h-dvh flex-col overflow-hidden bg-transparent">
			<Header />
			<FloatingNotice
				key={pendingDelete?.presentation.id}
				error={error || notice}
				success={pendingDelete ? "Presentation deleted" : null}
				action={!error && !notice && pendingDelete ? { label: "Undo", onClick: undoDelete } : null}
				onDismiss={() => {
					setError("");
					setNotice(null);
					commitPendingDelete();
				}}
			/>
			<div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-8 md:py-8">
				<div className="max-w-7xl mx-auto">
					<div
						data-horizon-reveal
						className="mb-8 flex flex-col gap-3 border-b border-white/10 pb-6 sm:flex-row sm:items-center"
					>
						<SearchBar
							id="presentation-search"
							label="Search presentations"
							value={searchQuery}
							onChange={setSearchQuery}
							placeholder="Search by title, prompt, or date..."
						/>
						<div className="hidden sm:block">
							<GridSizeControl gridSize={gridSize} onGridSizeChange={setGridSize} />
						</div>
					</div>

					{loading ? (
						<div
							className="flex min-h-64 items-center justify-center"
							role="status"
							aria-label="Loading presentations"
						>
							<ThinkingOrb size={64} className="opacity-60" aria-hidden="true" />
						</div>
					) : (
						<>
							<div
								data-horizon-reveal
								className={`grid grid-cols-1 ${
									gridSize === 2
										? "md:grid-cols-2"
										: gridSize === 3
											? "md:grid-cols-2 lg:grid-cols-3"
											: "md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
								} gap-5`}
							>
								{filteredPresentations.length === 0 ? (
									<div className="col-span-full flex flex-col items-center justify-center py-24 text-center">
										<h2 className="mb-2 text-xl text-white md:text-2xl">
											{presentations.length === 0
												? "No Presentations Generated Yet"
												: "No presentations match your search"}
										</h2>
									</div>
								) : (
									filteredPresentations.map((presentation) => (
										<PresentationCard
											key={presentation.id}
											presentation={presentation}
											isOpening={openingId === presentation.id}
											onCardClick={handlePresentationClick}
											onPrefetch={prefetchPresentation}
											onDelete={handleDeletePresentation}
											formatDate={formatDate}
										/>
									))
								)}
							</div>

							{pagination.hasMore ? (
								<div className="mt-8 flex flex-col items-center gap-3 pb-4">
									<p className="text-sm text-white/45">
										Showing {presentations.length} of {pagination.total}
									</p>
									<Button
										type="button"
										variant="outline"
										disabled={loadingMore}
										onClick={() =>
											void fetchPresentations({
												append: true,
												offset: presentations.length,
											})
										}
										className="border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
									>
										{loadingMore ? (
											<>
												<ThinkingOrb size={20} className="mr-2" />
												Loading...
											</>
										) : (
											"Load more"
										)}
									</Button>
								</div>
							) : null}
						</>
					)}
				</div>
			</div>
		</div>
	);
}
