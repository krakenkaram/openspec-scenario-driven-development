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

export const theme = createTheme({
  primaryColor: "magenta",
  primaryShade: { light: 6, dark: 6 },
  respectReducedMotion: true,
  colors: { magenta, purple },
});
