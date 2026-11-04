export const MAX_CHECKPOINT_BYTES = 64_000;
const STATES = ["queued", "running", "blocked", "failed", "awaiting approval", "completed"];
const STAGES = ["validate", "draft", "quality", "approval", "release", "control"];
const HASH = /^[a-f0-9]{64}$/;
export interface TaskCheckpoint {
  job: string; status: string; stage: string; at: string; fixture: boolean;
  input?: string; review?: string; approved: boolean; qualityFailures?: number;
  artifacts: string[];
}
/** Accept only the existing runner's bounded metadata; never keep arbitrary imported payloads. */
export function parseCheckpoint(text: string): TaskCheckpoint {
  if (new TextEncoder().encode(text).length > MAX_CHECKPOINT_BYTES) throw new Error("Report too large");
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || !/^product-[a-f0-9]{24}$/.test(value.job_id) || !STATES.includes(value.status) || !STAGES.includes(value.stage) || typeof value.observed_at !== "string" || !Number.isFinite(Date.parse(value.observed_at)) || value.model_calls !== 0) throw new Error("Unsupported report");
  if (value.execution_source && value.execution_source !== "local deterministic handoff") throw new Error("Unsupported source");
  for(const key of ["input_hash","review_hash"]) if(value[key] !== undefined && (typeof value[key] !== "string" || !HASH.test(value[key]))) throw new Error("Invalid version");
  const artifacts = Object.entries(value.artifacts ?? {});
  if (artifacts.length > 20 || artifacts.some(([name,hash])=> !/^(listing\.json|mockup-\d+\.jpg)$/.test(name) || typeof hash !== "string" || !HASH.test(hash))) throw new Error("Invalid artifact metadata");
  const failures = value.quality_failed_checks;
  if(failures !== undefined && (!Number.isInteger(failures) || failures < 0 || failures > 10000)) throw new Error("Invalid quality result");
  return {job:value.job_id,status:value.status,stage:value.stage,at:value.observed_at,fixture:value.fixture === true,input:value.input_hash,review:value.review_hash,approved:!!value.review_hash && value.approval?.hash === value.review_hash,qualityFailures:failures,artifacts:artifacts.map(([name])=>name)};
}
