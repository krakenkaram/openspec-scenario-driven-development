import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";
import { mockApi } from "./test-fixtures";

describe("app branding — header", () => {
  it("shows the Tentacles name in the header", async () => {
    mockApi();
    render(<App />);
    expect(await screen.findByRole("heading", { name: /tentacles/i })).toBeInTheDocument();
  });
});
