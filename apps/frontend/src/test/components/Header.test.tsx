/// <reference lib="dom" />

import { describe, it, expect } from "bun:test";
import { render } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { ClerkProvider } from "@clerk/clerk-react";
import Header from "../../components/Header";

describe("Header", () => {
  it("renders header component", () => {
    const { container } = render(
      <BrowserRouter>
        <ClerkProvider publishableKey="pk_test_mock">
          <Header />
        </ClerkProvider>
      </BrowserRouter>,
    );

    // Header should be present
    const header = container.querySelector("header");
    expect(header).toBeInTheDocument();
  });
});
