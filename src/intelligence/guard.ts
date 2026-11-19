// Fixed checks on any text going into agent memory or out to an agent. Retrieved documents and
// stored memories are untrusted data: they are checked for secrets before they are kept and for
// instruction-like text before they are handed to a model. No model is asked to judge either.

const SECRET_PATTERNS: [RegExp, string][] = [
  [/\bsk-(ant-)?[A-Za-z0-9_-]{16,}/, "an API key"],
  [/\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/, "a GitHub token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "an AWS access key"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, "a Slack token"],
  [/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{16,}/, "a Stripe key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "a signed token (JWT)"],
  [/\bbearer\s+[A-Za-z0-9._~+/-]{20,}/i, "a bearer token"],
  [/\b(password|passwd|api[_-]?key|secret|token)\s*[:=]\s*\S{6,}/i, "a credential"],
];

/** What kind of secret the text seems to hold, or null. A match is refused, never redacted and kept. */
export function secretIn(text: string): string | null {
  for (const [re, what] of SECRET_PATTERNS) if (re.test(text)) return what;
  return null;
}

const INJECTION_PATTERNS: RegExp[] = [
  /\bignore (all |any )?(previous|prior|above|earlier) (instructions|rules|prompts?)/i,
  /\bdisregard (the |all |your )?(system|previous|prior) (prompt|instructions)/i,
  /\byou are now\b/i,
  /\b(new|updated) (system )?instructions?:/i,
  /\bsystem prompt\b/i,
  /\b(reveal|print|show) (your|the) (prompt|instructions|secrets?|keys?)/i,
  /\b(approve|merge|publish|deploy) (this|it) (now|immediately|without)/i,
  /\b(grant|give) (yourself|the agent) (access|permission)/i,
  /<\/?(system|assistant|instructions?)>/i,
];

/** Why the text reads like an instruction to a model, or null. */
export function injectionIn(text: string): string | null {
  for (const re of INJECTION_PATTERNS) {
    const m = text.match(re);
    if (m) return `Reads like an instruction: "${m[0].slice(0, 60)}"`;
  }
  return null;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Trims, drops control characters and caps length. */
export function clean(text: string, max: number): string {
  return text.replace(CONTROL, "").trim().slice(0, max);
}

/** Field names that would carry hidden reasoning. Decision records never store them. */
export const REASONING_KEYS = ["reasoning", "chainOfThought", "chain_of_thought", "thoughts", "thinking", "scratchpad"];

export const isHttps = (u: string) => {
  try {
    return new URL(u).protocol === "https:";
  } catch {
    return false;
  }
};

/** Rough token count (4 characters a token). Good enough for a budget; never shown as billed. */
export const estTokens = (text: string) => Math.ceil(text.length / 4);
