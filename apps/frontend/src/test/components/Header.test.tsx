/// <reference lib="dom" />

import { describe, it, expect } from "bun:test";
import { render } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import Header from "../../components/Header";
import { AuthProvider } from "../../features/auth/contexts/AuthContext";

describe("Header", () => {
  it("renders header component", () => {
    const { container } = render(
      <BrowserRouter>
        <AuthProvider>
          <Header />
        </AuthProvider>
      </BrowserRouter>
    );

    // Header should be present
    const header = container.querySelector("header");
    expect(header).toBeInTheDocument();
  });
});
