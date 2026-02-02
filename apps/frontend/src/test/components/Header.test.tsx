/// <reference lib="dom" />

import { describe, it, expect, mock } from "bun:test";
import { render } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";

mock.module("@clerk/clerk-react", () => {
  return {
    useUser: () => ({ user: null }),
    UserButton: () => null,
  };
});

describe("Header", () => {
  it("renders header component", async () => {
    // Import after mocking Clerk.
    const { default: Header } = await import("../../components/Header");

    const { container } = render(
      <BrowserRouter>
        <Header />
      </BrowserRouter>,
    );

    // Header should be present
    const header = container.querySelector("header");
    expect(header).toBeInTheDocument();
  });
});
