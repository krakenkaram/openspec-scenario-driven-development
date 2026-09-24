import type { ReactNode } from "react";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { theme } from "./theme";

// Render a component under the Tentacles MantineProvider, mirroring how the app
// wraps its tree at runtime. Component tests use this instead of bare render so
// Mantine primitives resolve their theme/context.
export function renderWithMantine(ui: ReactNode, options?: RenderOptions): RenderResult {
  return render(<MantineProvider theme={theme}>{ui}</MantineProvider>, options);
}
