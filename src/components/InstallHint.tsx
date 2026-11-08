import { useState } from "react";
import { isTauri } from "../lib/env";
import { isStandalone, shouldSuggestInstall } from "../lib/install";
import { PHONE_QUERY, useMedia } from "../lib/media";
import { load, save } from "../lib/storage";
import { Icon } from "./Icon";

const KEY = "installHintDismissed";

/** One dismissible line, on a phone browser only: how to keep Atlas on the Home Screen as an app. */
export function InstallHint() {
  const phone = useMedia(PHONE_QUERY);
  const [dismissed, setDismissed] = useState(() => load<boolean>(KEY, false));
  if (!shouldSuggestInstall({ tauri: isTauri(), phone, standalone: isStandalone(), dismissed })) return null;
  return (
    <div className="install-hint" role="note">
      <span className="grow">
        <b>Keep Atlas as an app.</b> In Safari tap <b>Share</b>, then <b>Add to Home Screen</b>. It opens full screen and updates itself.
      </span>
      <button
        className="icon-btn"
        aria-label="Hide this tip"
        onClick={() => {
          save(KEY, true);
          setDismissed(true);
        }}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
