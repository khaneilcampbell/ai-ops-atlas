import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauri } from "../lib/env";

const RECHECK_MS = 2 * 60 * 60 * 1000;

/**
 * Shown in the header once a newer build of main is published. The desktop app checks the
 * signed update feed on launch and every two hours; pressing the button downloads the
 * update, verifies its signature, replaces the app and restarts it.
 */
export function UpdateButton() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [state, setState] = useState<{ busy: boolean; pct?: number; error?: string }>({ busy: false });

  useEffect(() => {
    if (!isTauri()) return;
    let live = true;
    const look = () =>
      check()
        .then((u) => live && u && setUpdate(u))
        // Offline or the feed is missing: try again at the next check.
        .catch(() => undefined);
    const first = setTimeout(look, 5000);
    const every = setInterval(look, RECHECK_MS);
    return () => {
      live = false;
      clearTimeout(first);
      clearInterval(every);
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
      await relaunch();
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
      title={state.error ? `The update failed: ${state.error}. Press to try again.` : `Install version ${update.version} and restart Atlas.`}
    >
      <span className="dot" />
      {state.error ? "Update failed, retry" : label}
    </button>
  );
}
