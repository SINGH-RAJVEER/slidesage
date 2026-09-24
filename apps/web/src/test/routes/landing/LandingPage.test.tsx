import { describe, expect, it, mock } from "bun:test";
import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const ORB_LINK = "SlideSage — sign up";

const authState: { isSignedIn: boolean; loading: boolean; user: { landingPage?: string } | null } =
	{
		isSignedIn: false,
		loading: false,
		user: null,
	};

mock.module("@slidesage/ui", () => ({
	useAuth: () => authState,
	LoadingScreen: ({ label }: { label: string }) => <div>{label}</div>,
}));

describe("LandingPage", () => {
	it("renders only the wordmark orb, with no header or copy sections", async () => {
		const { default: LandingPage } = await import("../../../routes/landing/LandingPage");

		const { getByRole, queryByRole, container } = render(
			<MemoryRouter>
				<LandingPage />
			</MemoryRouter>,
		);

		expect(queryByRole("banner")).not.toBeInTheDocument();
		expect(queryByRole("contentinfo")).not.toBeInTheDocument();
		/* the sphere is the page's single call to action */
		expect(getByRole("link", { name: ORB_LINK })).toHaveAttribute("href", "/sign-up");
		expect(container.querySelectorAll("h1, h2, p")).toHaveLength(0);
	});
});

describe("EntranceRoute", () => {
	it("shows the landing page to anonymous visitors", async () => {
		authState.isSignedIn = false;
		authState.user = null;
		const { default: EntranceRoute } = await import("../../../app/router/EntranceRoute");

		const { findByRole } = render(
			<MemoryRouter>
				<EntranceRoute />
			</MemoryRouter>,
		);

		/* the landing page is split out of the initial bundle, so it arrives a
		   chunk later rather than in the first render */
		expect(await findByRole("link", { name: ORB_LINK })).toBeInTheDocument();
	});

	it("keeps a signed-in visitor on the landing page when that is their default", async () => {
		authState.isSignedIn = true;
		authState.user = { landingPage: "landing" };
		const { default: EntranceRoute } = await import("../../../app/router/EntranceRoute");

		const { findByRole } = render(
			<MemoryRouter>
				<EntranceRoute />
			</MemoryRouter>,
		);

		expect(await findByRole("link", { name: ORB_LINK })).toBeInTheDocument();
	});

	it("forwards a signed-in visitor whose default is an app page", async () => {
		authState.isSignedIn = true;
		authState.user = { landingPage: "generate" };
		const { default: EntranceRoute } = await import("../../../app/router/EntranceRoute");

		const { queryByRole } = render(
			<MemoryRouter>
				<EntranceRoute />
			</MemoryRouter>,
		);

		await act(async () => {});
		expect(queryByRole("link", { name: ORB_LINK })).not.toBeInTheDocument();
	});
});
