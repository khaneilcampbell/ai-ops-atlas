import { useSyncExternalStore } from "react";
import { useAtlas } from "../state";
import { stewardStore } from "./store";

/** In-app only: no OS notification permission, external messages or noisy unchanged-run alerts. */
export function StewardNotice() {
  const { notice } = useSyncExternalStore(stewardStore.subscribe, stewardStore.snapshot);
  const { setView } = useAtlas();
  if (!notice) return null;
  return <div className="notice" role="status" style={{ marginBottom: 16 }}>
    <span className="grow">{notice.message}</span>
    <button className="text-btn" onClick={() => setView("intel")}>Review in Intel → GitHub Steward</button>
    <button className="text-btn" onClick={stewardStore.dismiss}>Dismiss</button>
  </div>;
}
