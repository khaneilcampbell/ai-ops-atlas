import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AtlasProvider } from "./state";
import "./styles/app.css";
import { isTauri } from "./lib/env";

// The macOS window uses an overlay title bar, so the header leaves room for the traffic lights.
if (isTauri() && /Mac/.test(navigator.userAgent)) document.documentElement.classList.add("mac-app");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AtlasProvider>
      <App />
    </AtlasProvider>
  </React.StrictMode>,
);
