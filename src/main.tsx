import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AtlasProvider } from "./state";
import { IntelProvider } from "./intel/state";
import { ActionsProvider } from "./actions/state";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/mobile.css";
import "./styles/polished.css";
import { isTauri } from "./lib/env";
import { VaultGate } from "./components/VaultGate";

// The macOS window uses an overlay title bar, so the header leaves room for the traffic lights.
// In full screen macOS hides them, so the room is dropped and the logo sits back at the left edge.
if (isTauri() && /Mac/.test(navigator.userAgent)) {
  document.documentElement.classList.add("mac-app");
  void watchFullscreen();
}

async function watchFullscreen() {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    const sync = async () => document.documentElement.classList.toggle("mac-fullscreen", await win.isFullscreen());
    await sync();
    await win.onResized(() => void sync());
  } catch {
    // Keep the traffic-light room if the window API is unavailable.
  }
}

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
