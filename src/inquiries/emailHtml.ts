// The Benjaire email design for replies written from Atlas. It is the same look as the automatic
// "We received your message" email (header banner, white card, grey footer), ported from the
// n8n Flow intake so a reply KC sends from Gmail matches it. Pure string building, no network:
// the banner is an image on benjaire.com that Gmail fetches when the message is opened.

const IMG = "https://benjaire.com/brand/email/";
const FONT = "Inter,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "'IBM Plex Mono',Menlo,Consolas,monospace";

export const escapeHtml = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain draft text to paragraphs: blank lines split paragraphs, single line breaks stay as breaks. */
function paragraphs(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** The full branded email (HTML document) for a plain-text draft body. */
export function brandedEmailHtml(body: string): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head><body style="margin:0;padding:0;background:#f3f3f1">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f3f1"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #dcdddb;border-radius:12px;border-collapse:separate;overflow:hidden">` +
    `<tr><td bgcolor="#121315" style="padding:0;background-color:#121315;border-radius:12px 12px 0 0"><img src="${IMG}email-header-banner.png" width="600" alt="Benjaire" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;border-radius:12px 12px 0 0;color:#6f747b;font:600 14px/72px Arial,sans-serif;letter-spacing:3px"></td></tr>` +
    `<tr><td style="padding:28px;font:15px/1.6 ${FONT};color:#1f2124">${paragraphs(body)}</td></tr>` +
    `<tr><td style="background:#f3f3f1;border-top:1px solid #dcdddb;padding:20px 28px;font:12px/1.7 ${FONT};color:#565b62;border-radius:0 0 12px 12px">` +
    `<div style="font-family:${MONO};font-size:11px;letter-spacing:1.3px;text-transform:uppercase;color:#6f747b">Benjaire &middot; New York, NY</div>` +
    `<div><a href="https://benjaire.com" style="color:#565b62">benjaire.com</a> &middot; contact@benjaire.com</div>` +
    `</td></tr></table></td></tr></table></body></html>`
  );
}
