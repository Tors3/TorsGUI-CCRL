import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyFont } from "./lib/font";
import { applyTheme } from "./lib/theme";
import "./styles.css";
// the Retro fonts, bundled (OFL-1.1): DotGothic16 (dot-matrix) for text, IBM Plex Mono for numbers
import "@fontsource/dotgothic16/400.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/600.css";
// Gabor Szőts' initials engraved on h8 of the Szőts board (OFL-1.1)
import "@fontsource/pinyon-script/400.css";

applyTheme();
applyFont();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
