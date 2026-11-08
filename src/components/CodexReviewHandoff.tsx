import type {Agent} from "../catalog/types";
import {CODEX_REVIEW_PROMPT,IMPROVEMENT_AGENT_ID} from "../catalog/improvementReview";
import {CopyButton} from "./bits";

/** A manual handoff, never an automatic model invocation. */
export function CodexReviewHandoff({agent}:{agent:Agent}) {
  const uiDesigner=agent.id==="atlas-ui-improvement-designer";
  const productionTeam=["atlas-production-coordinator","atlas-reliability-reviewer","atlas-performance-reviewer"].includes(agent.id);
  if(agent.id!==IMPROVEMENT_AGENT_ID&&!uiDesigner&&!productionTeam)return null;
  const prompt=productionTeam?`Follow ops/system-improvements/production-team.md as ${agent.name}. Review only supplied evidence and return at most three findings. Reports only; no edits, scheduled runs, or parallel agent sessions.`:uiDesigner?"Follow ops/system-improvements/ui-design-prompt.md. Review the supplied current Atlas screenshots and focused evidence. Return at most three UI improvements. Reports only; do not edit code or launch further reviews.":CODEX_REVIEW_PROMPT;
  return <div style={{marginBottom:16}}>
    <p className="muted small">{productionTeam?`Atlas · Floor ${agent.officeFloor}`:`${agent.workplace?.building} · Floor ${agent.workplace?.floor} · Suite ${agent.workplace?.room}`}. Automatic reports use no model; manual Codex reviews consume your model allowance.</p>
    <CopyButton text={()=>prompt} label="Copy Codex review prompt"/>
  </div>;
}
