import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

try {
  document.documentElement.dataset.theme = localStorage.getItem("torsgui-theme") || "dark";
} catch {
  document.documentElement.dataset.theme = "dark";
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
