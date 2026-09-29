/// <reference lib="dom" />

import { beforeEach, describe, expect, it, mock } from "bun:test";
import DownloadMenu, {
	type PresentationExporter,
} from "@slidesage/ui/components/Viewer/DownloadMenu";
import { fireEvent, render, waitFor } from "@testing-library/react";

const exportPptx = mock(async () => {});

const exportPresentation: PresentationExporter = async () => {
	await exportPptx();
};

const openMenu = (button: HTMLElement) => {
	fireEvent.pointerDown(button, { button: 0, ctrlKey: false });
};

describe("DownloadMenu", () => {
	beforeEach(() => {
		exportPptx.mockClear();
		exportPptx.mockImplementation(async () => {});
	});

	it("downloads the current presentation as PPTX", async () => {
		const view = render(<DownloadMenu onExport={exportPresentation} />);
		openMenu(view.getByRole("button", { name: /Download/ }));
		fireEvent.click(await view.findByText("PowerPoint"));

		await waitFor(() => expect(exportPptx).toHaveBeenCalledTimes(1));
	});

	// Export is built from a saved revision, so a deck with unsaved edits or
	// none at all has nothing to hand over.
	it("disables downloads while there is no saved revision", () => {
		const view = render(<DownloadMenu onExport={exportPresentation} disabled />);
		expect(view.getByRole("button", { name: /Download/ })).toBeDisabled();
	});

	it("ignores a second export while the first export is pending", async () => {
		let release: (() => void) | undefined;
		exportPptx.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		const view = render(<DownloadMenu onExport={exportPresentation} />);
		openMenu(view.getByRole("button", { name: /Download/ }));
		fireEvent.click(await view.findByText("PowerPoint"));
		await waitFor(() => expect(exportPptx).toHaveBeenCalledTimes(1));

		fireEvent.click(view.getByRole("button", { name: /Exporting/ }));
		expect(exportPptx).toHaveBeenCalledTimes(1);

		release?.();
	});

	it("shows an accessible error when the export fails", async () => {
		exportPptx.mockImplementation(async () => {
			throw new Error("export boom");
		});
		const view = render(<DownloadMenu onExport={exportPresentation} />);
		openMenu(view.getByRole("button", { name: /Download/ }));
		fireEvent.click(await view.findByText("PowerPoint"));

		const alert = await view.findByRole("alert");
		expect(alert.textContent).toContain("PPTX export failed");
	});
});
