import { afterEach, describe, expect, it, mock } from "bun:test";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

mock.module("@slidesage/ui", () => ({
	useAuth: () => ({ isSignedIn: false, loading: false, user: null }),
}));
const { HorizonTransitionProvider, useHorizonPageReady, useHorizonTransition } = await import(
	"../../app/transitions/HorizonTransition"
);
const originalAnimate = HTMLElement.prototype.animate;
const originalFrame = window.requestAnimationFrame;
afterEach(() => {
	HTMLElement.prototype.animate = originalAnimate;
	window.requestAnimationFrame = originalFrame;
});

describe("horizon route handoff", () => {
	it("covers navigation, waits for destination data, and releases the page after revealing", async () => {
		const finishes: (() => void)[] = [];
		HTMLElement.prototype.animate = (() => {
			const finished = new Promise<void>((resolve) => finishes.push(resolve));
			return { finished, cancel() {} } as unknown as Animation;
		}) as typeof HTMLElement.prototype.animate;
		window.requestAnimationFrame = (callback) => {
			queueMicrotask(() => callback(performance.now()));
			return 1;
		};
		function Trigger() {
			const transition = useHorizonTransition();
			return (
				<button type="button" onClick={() => transition?.begin({ x: 100, y: 100, radius: 30 })}>
					Enter
				</button>
			);
		}
		function Destination({ ready }: { ready: boolean }) {
			useHorizonPageReady(ready);
			return <h1>{ready ? "Ready form" : "Loading form"}</h1>;
		}
		function App({ ready }: { ready: boolean }) {
			return (
				<MemoryRouter>
					<HorizonTransitionProvider>
						<Routes>
							<Route path="/" element={<Trigger />} />
							<Route path="/sign-up" element={<Destination ready={ready} />} />
						</Routes>
					</HorizonTransitionProvider>
				</MemoryRouter>
			);
		}
		const view = render(<App ready={false} />);
		fireEvent.click(view.getByText("Enter"));
		expect(view.container.querySelector(".horizon-route-cover")?.getAttribute("data-phase")).toBe(
			"cover",
		);
		// Repeated activation must not start a second navigation/cover animation.
		fireEvent.click(view.getByText("Enter"));
		expect(finishes).toHaveLength(1);
		await act(async () => {
			finishes[0]?.();
		});
		await waitFor(() => expect(view.getByText("Loading form")).toBeInTheDocument());
		expect(view.container.querySelector(".horizon-route-cover")?.getAttribute("data-phase")).toBe(
			"waiting",
		);
		expect(
			(view.container.querySelector(".horizon-route-content") as HTMLElement).style.visibility,
		).toBe("hidden");
		view.rerender(<App ready={true} />);
		await waitFor(() => expect(finishes.length).toBeGreaterThan(1));
		await act(async () => {
			for (const finish of finishes) finish();
		});
		await waitFor(() => expect(view.container.querySelector(".horizon-route-cover")).toBeNull());
		expect(view.container.querySelector(".horizon-route-content")?.hasAttribute("inert")).toBe(
			false,
		);
		expect(view.getByText("Ready form")).toHaveFocus();
		// The landing focus must not paint a ring across the revealed page.
		expect(view.getByText("Ready form")).toHaveAttribute("data-horizon-focus");
		act(() => {
			fireEvent.blur(view.getByText("Ready form"));
		});
		expect(view.getByText("Ready form")).not.toHaveAttribute("data-horizon-focus");
		expect(view.getByText("Ready form")).not.toHaveAttribute("tabindex");
	});
	it("cancels a pending cover on Back and ignores its late completion", async () => {
		let finish: (() => void) | undefined;
		HTMLElement.prototype.animate = (() => ({
			finished: new Promise<void>((resolve) => {
				finish = resolve;
			}),
			cancel() {},
		})) as unknown as typeof HTMLElement.prototype.animate;
		function Trigger() {
			const transition = useHorizonTransition();
			return (
				<button type="button" onClick={() => transition?.begin({ x: 100, y: 100, radius: 30 })}>
					Enter
				</button>
			);
		}
		const view = render(
			<MemoryRouter>
				<HorizonTransitionProvider>
					<Routes>
						<Route path="/" element={<Trigger />} />
						<Route path="/sign-up" element={<h1>Unexpected navigation</h1>} />
					</Routes>
				</HorizonTransitionProvider>
			</MemoryRouter>,
		);
		fireEvent.click(view.getByText("Enter"));
		expect(view.container.querySelector(".horizon-route-cover")).not.toBeNull();
		act(() => window.dispatchEvent(new PopStateEvent("popstate")));
		expect(view.container.querySelector(".horizon-route-cover")).toBeNull();
		await act(async () => {
			finish?.();
		});
		expect(view.queryByText("Unexpected navigation")).toBeNull();
		expect(view.container.querySelector(".horizon-route-content")?.hasAttribute("inert")).toBe(
			false,
		);
		fireEvent.click(view.getByText("Enter"));
		expect(view.container.querySelector(".horizon-route-cover")).not.toBeNull();
	});
});
