// Shapes of the credentials Atlas handles: GitHub, Anthropic, OpenAI, Resend, Slack, AWS, JWTs, PEM
// private keys and a "Bearer <anything>" header value. Used to mask logs (server/log.ts) and to keep
// credentials out of backups (src/lib/backup.ts). Fresh RegExp objects each call: they are global.
export function secretPatterns(): RegExp[] {
  return [
    /gh[pousr]_[A-Za-z0-9]{20,}/g,
    /github_pat_[A-Za-z0-9_]{20,}/g,
    /sk-ant-[A-Za-z0-9_-]{16,}/g,
    /sk-[A-Za-z0-9]{20,}/g,
    /re_[A-Za-z0-9_]{20,}/g,
    /xox[abprs]-[A-Za-z0-9-]{10,}/g,
    /AKIA[0-9A-Z]{16}/g,
    /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    /\b[Bb]earer\s+[^\s"',]+/g,
  ];
}

/** True when the text contains anything shaped like a credential. */
export const looksSecret = (text: string): boolean => secretPatterns().some((re) => re.test(text));
