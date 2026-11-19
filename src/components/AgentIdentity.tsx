import { useState } from "react";
import "../styles/identity.css";
import { catalog } from "../catalog";
import { identityFor, type ResolvedIdentity } from "../registry/identity";
import { IDENTITY_STATUS_LABEL, type IdentityStatus } from "../registry/agentStatus";

/** The identity Atlas shows for an agent id, with the name saved on the work as a fallback. */
export function useAgentIdentity(agentId: string, savedName?: string): ResolvedIdentity {
  return identityFor(agentId, catalog.agents, savedName);
}

/** Portrait in an accent ring, or initials when there is no portrait or it fails to load. */
export function AgentAvatar({ identity, size = 32, status }: { identity: ResolvedIdentity; size?: number; status?: IdentityStatus }) {
  const [broken, setBroken] = useState(false);
  const showImage = identity.portrait && !broken;
  return (
    <span className={`agent-avatar ${identity.retired ? "retired" : ""}`} style={{ width: size, height: size, ["--accent" as string]: identity.accent }}>
      {showImage ? (
        <img src={identity.portrait!} alt="" width={size} height={size} loading="lazy" decoding="async" onError={() => setBroken(true)} />
      ) : (
        <span className="agent-initials" style={{ fontSize: Math.max(9, Math.round(size * 0.38)) }} aria-hidden>
          {identity.initials}
        </span>
      )}
      {status && <i className={`agent-status-dot st-${status}`} title={IDENTITY_STATUS_LABEL[status]} aria-hidden />}
    </span>
  );
}

export function AiAgentLabel() {
  return <span className="ai-agent-label">AI agent</span>;
}

export function AgentStatusPill({ status }: { status: IdentityStatus }) {
  return (
    <span className={`agent-status-pill st-${status}`}>
      <i className={`agent-status-dot st-${status}`} aria-hidden />
      {IDENTITY_STATUS_LABEL[status]}
    </span>
  );
}

/**
 * Name, role, portrait and the "AI agent" label in one line. For an automation shown under its
 * owner, or a skill under its lead, the automation's name follows "via".
 */
export function AgentIdentityLine({ identity, status, size = 32, showRole = true, lead = "persona" }: { identity: ResolvedIdentity; status?: IdentityStatus; size?: number; showRole?: boolean; lead?: "persona" | "agent" }) {
  // In a list of agents to choose from, an automation leads with its own name and says who runs it,
  // so the owner's name isn't repeated once per automation.
  const byAgent = lead === "agent" && identity.via !== null;
  const name = byAgent ? identity.via! : identity.name;
  const role = byAgent ? `Run by ${identity.name}, AI agent · ${identity.role}` : `${identity.role}${identity.via ? ` · via ${identity.via}` : ""}`;
  return (
    <span className="agent-identity">
      <AgentAvatar identity={identity} size={size} status={status} />
      <span className="agent-identity-text">
        <span className="agent-identity-name">
          <span className="selectable">{name}</span>
          {!byAgent && <AiAgentLabel />}
        </span>
        {showRole && (
          <span className="agent-identity-role">
            {role}
            {identity.retired ? " · Retired" : ""}
          </span>
        )}
        {status && <span className="sr-only">Status: {IDENTITY_STATUS_LABEL[status]}</span>}
      </span>
    </span>
  );
}
