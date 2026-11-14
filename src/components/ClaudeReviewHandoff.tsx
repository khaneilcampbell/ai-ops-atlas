import type {Agent} from "../catalog/types";
import {CopyButton} from "./bits";

/** A manual handoff, never an automatic model invocation. */
export function ClaudeReviewHandoff({agent}:{agent:Agent}) {
  if(agent.id!=="atlas-production-coordinator")return null;
  const prompt=`Follow ops/system-improvements/production-team.md as ${agent.name}. Review only supplied evidence and return at most three findings. Reports only; no edits, scheduled runs, or parallel agent sessions.`;
  return <div style={{marginBottom:16}}>
    <p className="muted small">Atlas · Floor {agent.officeFloor}. Manual Claude Code reviews consume your model allowance.</p>
    <CopyButton text={()=>prompt} label="Copy Claude Code review prompt"/>
  </div>;
}
