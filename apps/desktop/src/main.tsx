import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/base.css";
import "./styles/pages.css";
import { isTauri } from "./lib/tauri";

if (isTauri()) document.documentElement.classList.add("tauri");
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
