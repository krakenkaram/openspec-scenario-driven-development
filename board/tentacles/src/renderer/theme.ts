import { createTheme, type MantineColorsTuple } from "@mantine/core";

// Brand magenta-pink (anchored ~#D6197D at index 6, Mantine's default filled shade).
const magenta: MantineColorsTuple = [
  "#fdeaf3",
  "#f9cbe0",
  "#f3a4c8",
  "#ee7db0",
  "#e85699",
  "#e23087",
  "#d6197d",
  "#b21568",
  "#8d1152",
  "#680c3d",
];

// Deep purple support colour (anchored ~#4A2C6F at index 7) for surfaces/headers.
const purple: MantineColorsTuple = [
  "#f2edf7",
  "#ddd0ec",
  "#c3aede",
  "#a888cf",
  "#8f66c2",
  "#7c4fb8",
  "#5f3a92",
  "#4a2c6f",
  "#3a2257",
  "#2a1840",
];

// Deep navy shell. Overrides Mantine's `dark` scale so the body, panels, cards
// and borders render as the Tentacles navy in dark mode. Index mapping Mantine
// consumes: 0 = text, 2 = dimmed text, 4 = default border, 5 = hover, 6 = default
// surface (cards), 7 = body background, 8-9 = deepest (rail).
const navy: MantineColorsTuple = [
  "#e6edf7",
  "#c7d0e0",
  "#8792ad",
  "#5a6685",
  "#2b3654",
  "#222c46",
  "#1a2238",
  "#0c1120",
  "#080b14",
  "#05070e",
];

export const theme = createTheme({
  primaryColor: "magenta",
  primaryShade: { light: 6, dark: 6 },
  respectReducedMotion: true,
  defaultRadius: "md",
  colors: { magenta, purple, dark: navy },
});
