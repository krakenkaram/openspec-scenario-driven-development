import { createRoot } from "react-dom/client";
import "@mantine/core/styles.css";
import App from "./App";
import "./app.css";

const container = document.getElementById("app");
if (container) createRoot(container).render(<App />);
