/// <reference lib="dom" />

import { describe, expect, it, mock } from "bun:test";
import { PREFETCH_INTENT_DELAY_MS, usePrefetchIntent } from "@slidesage/ui/hooks/usePrefetchIntent";
import { fireEvent, render } from "@testing-library/react";

function Target({ onPrefetch }: { onPrefetch: () => void }) {
	const intent = usePrefetchIntent(onPrefetch);
	return (
		<button type="button" {...intent}>
			Open
		</button>
	);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("usePrefetchIntent", () => {
	it("prefetches once a mouse rests on the target", async () => {
		const onPrefetch = mock(() => {});
		const view = render(<Target onPrefetch={onPrefetch} />);

		fireEvent.pointerEnter(view.getByRole("button"), { pointerType: "mouse" });
		expect(onPrefetch).not.toHaveBeenCalled();

		await wait(PREFETCH_INTENT_DELAY_MS + 20);
		expect(onPrefetch).toHaveBeenCalledTimes(1);
	});

	it("ignores a mouse that passes over on its way elsewhere", async () => {
		const onPrefetch = mock(() => {});
		const view = render(<Target onPrefetch={onPrefetch} />);
		const button = view.getByRole("button");

		fireEvent.pointerEnter(button, { pointerType: "mouse" });
		fireEvent.pointerLeave(button, { pointerType: "mouse" });

		await wait(PREFETCH_INTENT_DELAY_MS + 20);
		expect(onPrefetch).not.toHaveBeenCalled();
	});

	it("prefetches at once on touch and keyboard focus", () => {
		const onPrefetch = mock(() => {});
		const view = render(<Target onPrefetch={onPrefetch} />);
		const button = view.getByRole("button");

		fireEvent.pointerDown(button, { pointerType: "touch" });
		fireEvent.focus(button);

		expect(onPrefetch).toHaveBeenCalledTimes(2);
	});
});
