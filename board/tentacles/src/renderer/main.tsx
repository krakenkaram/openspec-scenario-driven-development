import { createRoot } from "react-dom/client";
import "@mantine/core/styles.css";
import App from "./App";
import "./styles.css";

const container = document.getElementById("app");
if (container) createRoot(container).render(<App />);
