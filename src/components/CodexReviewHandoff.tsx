import type {Agent} from "../catalog/types";
import {CODEX_REVIEW_PROMPT,IMPROVEMENT_AGENT_ID} from "../catalog/improvementReview";
import {CopyButton} from "./bits";

/** A manual handoff, never an automatic model invocation. */
export function CodexReviewHandoff({agent}:{agent:Agent}) {
  if(agent.id!==IMPROVEMENT_AGENT_ID)return null;
  return <div style={{marginBottom:16}}>
    <p className="muted small">{agent.workplace?.building} · Floor {agent.workplace?.floor} · Suite {agent.workplace?.room}. Automatic reports use no model; manual Codex reviews consume your model allowance.</p>
    <CopyButton text={()=>CODEX_REVIEW_PROMPT} label="Copy Codex review prompt"/>
  </div>;
}
