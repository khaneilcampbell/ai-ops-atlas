import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { isTauri } from "../lib/env";
import { useAtlas } from "../state";

const RECHECK_MS = 10 * 60 * 1000;
// Coming back to the window checks again, but not more than once a minute.
const FOCUS_GAP_MS = 60 * 1000;

/**
 * Shown in the header once a newer build of main is published. The desktop app checks the
 * signed update feed on launch, every ten minutes and whenever the window comes back into focus; pressing the button downloads the
 * update, verifies its signature and replaces the app. The new copy opens on the same view
 * and window position and takes over the unlocked keys, so there's no Touch ID prompt.
 * Hovering the button shows the feed's notes: the newest CHANGELOG.md entries.
 */
export function UpdateButton() {
  const { view, selection } = useAtlas();
  const [update, setUpdate] = useState<Update | null>(null);
  const [state, setState] = useState<{ busy: boolean; pct?: number; error?: string }>({ busy: false });

  useEffect(() => {
    if (!isTauri()) return;
    let live = true;
    let last = 0;
    const look = () => {
      last = Date.now();
      return check()
        .then((u) => live && u && setUpdate(u))
        // Offline or the feed is missing: try again at the next check.
        .catch(() => undefined);
    };
    const onFocus = () => {
      if (Date.now() - last > FOCUS_GAP_MS) void look();
    };
    const first = setTimeout(look, 5000);
    const every = setInterval(look, RECHECK_MS);
    window.addEventListener("focus", onFocus);
    return () => {
      live = false;
      clearTimeout(first);
      clearInterval(every);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (!update) return null;

  const install = async () => {
    setState({ busy: true });
    let total = 0;
    let done = 0;
    try {
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        if (e.event === "Progress") {
          done += e.data.chunkLength;
          if (total) setState({ busy: true, pct: Math.round((done / total) * 100) });
        }
      });
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("update_relaunch", { resume: JSON.stringify({ view, selection }) });
    } catch (e) {
      setState({ busy: false, error: String(e) });
    }
  };

  const label = state.busy ? (state.pct !== undefined && state.pct < 100 ? `Updating… ${state.pct}%` : "Restarting…") : "Update available";
  return (
    <button
      className="pill-mode update"
      onClick={() => void install()}
      disabled={state.busy}
      title={
        state.error
          ? `The update failed: ${state.error}. Press to try again.`
          : `Install version ${update.version}. Atlas reopens where you are, still unlocked.${update.body ? `\n\nWhat's new:\n${update.body}` : ""}`
      }
    >
      <span className="dot" />
      {state.error ? "Update failed, retry" : label}
    </button>
  );
}
