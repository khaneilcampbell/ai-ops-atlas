import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { CopyValue } from "../components/bits";
import { newReplyKey, sendInquiryReply, useInquiries } from "../inquiries/client";
import { brandedEmailHtml } from "../inquiries/emailHtml";
import { followUpDraft, gmailCompose, nextStep, replyDraft, type Inquiry, type NextStep } from "../inquiries/model";
import { markClosed, markFollowedUp, markReplied, reopen, useInquiryProgress } from "../inquiries/state";
import { relative } from "../lib/time";
import "../styles/inquiries.css";

const TICK_MS = 60_000;

/**
 * Puts the branded version of the draft on the clipboard and opens a Gmail compose window with the
 * recipient and subject filled in. KC pastes (Cmd+V) into the message; Gmail keeps the design.
 * Nothing is sent from Atlas. If the clipboard is refused, the plain text is in the Gmail link.
 */
async function openDraft(to: string, draft: { subject: string; body: string }): Promise<string> {
  let copied: boolean;
  try {
    const html = brandedEmailHtml(draft.body);
    await navigator.clipboard.write([
      new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([draft.body], { type: "text/plain" }) }),
    ]);
    copied = true;
  } catch {
    copied = false;
  }
  const url = copied ? gmailCompose(to, { subject: draft.subject, body: "" }) : gmailCompose(to, draft);
  if ("__TAURI_INTERNALS__" in window) void import("@tauri-apps/plugin-opener").then((m) => m.openUrl(url));
  else window.open(url, "_blank", "noopener");
  return copied ? "Branded reply copied. Click in the Gmail message and press ⌘V to paste it." : "Gmail opened with plain text; the branded copy was blocked by the browser.";
}

const dateOnly = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

function stepChip(step: NextStep): { text: string; tone: string } {
  if (step.kind === "reply") return { text: step.overdue ? "Reply overdue" : "Reply needed", tone: step.overdue ? "bad" : "warn" };
  if (step.kind === "follow_up") return step.due ? { text: `Follow-up ${step.number} due`, tone: "warn" } : { text: `Follow-up ${step.number} ${dateOnly(step.dueAt)}`, tone: "wait" };
  return { text: "Done", tone: "done" };
}

/** Mission Control's client inbox: website inquiries, a drafted reply for each, and follow-up reminders. */
export function ClientInquiries() {
  const inbox = useInquiries();
  const progress = useInquiryProgress();
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState("");
  const onDraft = (to: string, draft: { subject: string; body: string }) => void openDraft(to, draft).then(setNotice);
  const onSent = (to: string) => setNotice(`Sent to ${to} in the Benjaire design. A copy is in your Gmail.`);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);
  const rows = useMemo(() => inbox.inquiries.map((i) => ({ i, step: nextStep(i, progress[i.id], now) })), [inbox.inquiries, progress, now]);
  const waiting = rows.filter((r) => r.step.kind === "reply" || (r.step.kind === "follow_up" && r.step.due)).length;
  // Still asking, or no site to ask (plain dev, or website sync not set up on this Mac): stay out of the way.
  if (inbox.state === "off" || inbox.state === "loading") return null;

  return (
    <section className="card client-inquiries" id="client-inquiries">
      <div className="card-head">
        <h2 className="grow">Client inquiries</h2>
        {inbox.state === "ready" && (
          <span className={`chip ${waiting ? "chip-warn" : ""}`}>
            <Icon name="alert" size={12} /> {waiting ? `${waiting} need${waiting === 1 ? "s" : ""} you` : "All answered"}
          </span>
        )}
      </div>
      {notice && (
        <p className="small inquiries-note" role="status">
          {notice}
        </p>
      )}
      {inbox.state === "error" && <p className="muted small inquiries-note">{inbox.message}</p>}
      {inbox.state === "ready" && !rows.length && <p className="muted small inquiries-note">No website inquiries yet. New ones from the benjaire.com contact form appear here.</p>}
      {rows.length > 0 && (
        <ul className="list">
          {rows.map(({ i, step }) => (
            <InquiryRow key={i.id} inquiry={i} step={step} canSend={inbox.canSend} onDraft={onDraft} onSent={onSent} />
          ))}
        </ul>
      )}
      <div className="card-foot muted small">
        {inbox.canSend
          ? "Replies are fixed templates in the Benjaire email design. Nothing reaches a client until you review it and press Send; a copy lands in your Gmail. Progress is kept on this device. No AI calls, no cost."
          : "Drafts are fixed templates in the Benjaire email design. They open in Gmail, so nothing reaches a client until you press Send there. Progress is kept on this device. No AI calls, no cost."}
      </div>
    </section>
  );
}

type Draft = { subject: string; body: string };

function InquiryRow({ inquiry: i, step, canSend, onDraft, onSent }: { inquiry: Inquiry; step: NextStep; canSend: boolean; onDraft: (to: string, draft: Draft) => void; onSent: (to: string) => void }) {
  const chip = stepChip(step);
  const [composing, setComposing] = useState<Draft | null>(null);
  // With sending set up on the site the button opens the editor; otherwise it uses the Gmail paste route.
  const draft = (d: Draft) => (canSend ? setComposing(d) : onDraft(i.email, d));
  const sent = (to: string) => {
    if (step.kind === "reply") markReplied(i.id);
    else if (step.kind === "follow_up") markFollowedUp(i.id);
    setComposing(null);
    onSent(to);
  };
  return (
    <li>
      <div className="list-row inquiry">
        <span className="grow">
          <span className="title">
            {i.name}
            {i.company ? <span className="muted"> · {i.company}</span> : null}
          </span>
          <div className="meta">
            {i.category_label} · {relative(i.received_at)} · <CopyValue value={i.email} title="Copy email address" />
          </div>
          <details className="inquiry-message">
            <summary>{i.message.length > 140 ? `${i.message.slice(0, 137)}…` : i.message}</summary>
            <p className="selectable">{i.message}</p>
          </details>
        </span>
        <span className={`chip inquiry-chip ${chip.tone}`}>{chip.text}</span>
        <span className="inquiry-actions">
          {step.kind === "reply" && (
            <>
              <button className="btn small" onClick={() => draft(replyDraft(i))} title={canSend ? "Review the branded reply, then send it" : "Copy the branded reply and open Gmail"}>
                Draft reply
              </button>
              <button className="text-btn small" onClick={() => markReplied(i.id)} title="You sent the reply; follow-ups are due on day 3 and day 7">
                Mark replied
              </button>
            </>
          )}
          {step.kind === "follow_up" && (
            <>
              <button className={step.due ? "btn small" : "btn small quiet"} onClick={() => draft(followUpDraft(i, step.number))} title={canSend ? "Review the branded follow-up, then send it" : "Copy the branded follow-up and open Gmail"}>
                Draft follow-up
              </button>
              <button className="text-btn small" onClick={() => markFollowedUp(i.id)}>
                Mark sent
              </button>
            </>
          )}
          {step.kind === "done" ? (
            <button className="text-btn small" onClick={() => reopen(i.id)}>
              Reopen
            </button>
          ) : (
            <button className="text-btn small" onClick={() => markClosed(i.id)} title="Won, lost or no reply needed: stop reminders">
              Close
            </button>
          )}
        </span>
      </div>
      {composing && <ReplyComposer inquiry={i} initial={composing} onCancel={() => setComposing(null)} onSent={sent} onGmail={(d) => onDraft(i.email, d)} />}
    </li>
  );
}

/** Edit the drafted text, see exactly the email the client will get, and send it from the site. */
function ReplyComposer({ inquiry: i, initial, onCancel, onSent, onGmail }: { inquiry: Inquiry; initial: Draft; onCancel: () => void; onSent: (to: string) => void; onGmail: (d: Draft) => void }) {
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // One key per composer, so a double tap or retry can't send twice.
  const [key] = useState(newReplyKey);
  const ready = subject.trim().length > 0 && body.trim().length > 0 && !/[\r\n]/.test(subject);
  const html = useMemo(() => brandedEmailHtml(body), [body]);
  const send = () => {
    setBusy(true);
    setError("");
    sendInquiryReply({ id: i.id, key, subject: subject.trim(), body })
      .then(onSent)
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
      });
  };
  return (
    <div className="reply-composer" role="group" aria-label={`Reply to ${i.name}`}>
      <div className="reply-field">
        <span className="muted small">To</span>
        <span className="selectable">{i.email}</span>
        <span className="muted small">· copy to your Gmail</span>
      </div>
      <label className="reply-field">
        <span className="muted small">Subject</span>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} aria-label="Subject" />
      </label>
      <label className="reply-field stack">
        <span className="muted small">Message</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={9} maxLength={10000} aria-label="Message" />
      </label>
      <div className="muted small">What the client will see</div>
      <iframe className="reply-preview" title="Email preview" sandbox="" srcDoc={html} />
      {error && (
        <p className="small reply-error" role="alert">
          {error}
        </p>
      )}
      <div className="reply-actions">
        <button className="btn small" disabled={!ready || busy} onClick={send}>
          {busy ? "Sending…" : `Send to ${i.email}`}
        </button>
        <button className="text-btn small" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button className="text-btn small" disabled={busy} onClick={() => onGmail({ subject, body })} title="Copy the branded email and open Gmail instead">
          Use Gmail instead
        </button>
      </div>
    </div>
  );
}
