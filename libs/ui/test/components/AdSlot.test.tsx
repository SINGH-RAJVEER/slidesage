import { describe, expect, it } from "bun:test";
import { type AdLinkProps, AdSlot } from "@slidesage/ui/components/AdSlot";
import { render } from "@testing-library/react";

const Link = ({ to, className, children }: AdLinkProps) => (
	<a href={to} className={className}>
		{children}
	</a>
);

describe("AdSlot", () => {
	it("renders nothing and loads no script when ads are not configured", () => {
		const { container } = render(
			<AdSlot
				placement="generate"
				height={90}
				maxWidth={728}
				purchaseHref="/purchase"
				LinkComponent={Link}
				config={null}
			/>,
		);

		expect(container).toBeEmptyDOMElement();
		expect(document.querySelector('script[src*="adsbygoogle"]')).toBeNull();
	});

	it("renders nothing before the session says the reader sees ads", () => {
		const { container } = render(
			<AdSlot
				placement="generate"
				height={90}
				maxWidth={728}
				purchaseHref="/purchase"
				LinkComponent={Link}
				config={{ clientId: "ca-pub-1234567890123456", slots: { generate: "1234567890" } }}
			/>,
		);

		expect(container).toBeEmptyDOMElement();
		expect(document.querySelector('script[src*="adsbygoogle"]')).toBeNull();
	});
});
