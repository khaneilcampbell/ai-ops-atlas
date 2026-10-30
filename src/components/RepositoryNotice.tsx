import { Icon } from "./Icon";
import { isHostedWeb, isTauri } from "../lib/env";
import { repositoryHelp } from "../lib/repositoryHelp";
import { useAtlas } from "../state";

export function RepositoryNotice({ message, actions = true }: { message: string; actions?: boolean }) {
  const { setView, refresh, refreshing } = useAtlas();
  const help = repositoryHelp(message, isTauri() ? "desktop" : isHostedWeb() ? "hosted" : "preview");
  return <div className="notice repository-notice">
    <Icon name="alert" size={16}/>
    <div><strong>{help.title}</strong><p>{help.detail}</p>
      {actions && <div className="repository-notice-actions"><button className="text-btn" disabled={refreshing} onClick={event => { event.stopPropagation(); void refresh(true); }}>{refreshing ? "Checking…" : "Refresh GitHub data"}</button><button className="text-btn" onClick={event => { event.stopPropagation(); setView("settings"); }}>Connection settings →</button></div>}
    </div>
  </div>;
}
