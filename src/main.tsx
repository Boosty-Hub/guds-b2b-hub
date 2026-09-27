import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { aplicarDensidad } from "./lib/densidad";

aplicarDensidad();

createRoot(document.getElementById("root")!).render(<App />);
