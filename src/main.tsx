import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AtlasProvider } from "./state";
import { IntelProvider } from "./intel/state";
import { ActionsProvider } from "./actions/state";
import "./styles/app.css";
import "./styles/mobile.css";
import "./styles/edit.css";
import { isTauri } from "./lib/env";
import { VaultGate } from "./components/VaultGate";

// The macOS window uses an overlay title bar, so the header leaves room for the traffic lights.
if (isTauri() && /Mac/.test(navigator.userAgent)) document.documentElement.classList.add("mac-app");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <VaultGate>
      <AtlasProvider>
        <IntelProvider>
          <ActionsProvider>
            <App />
          </ActionsProvider>
        </IntelProvider>
      </AtlasProvider>
    </VaultGate>
  </React.StrictMode>,
);
