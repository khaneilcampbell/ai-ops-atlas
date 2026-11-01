import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { CopyValue } from "../components/bits";
import { useInquiries } from "../inquiries/client";
import { followUpDraft, mailto, nextStep, replyDraft, type Inquiry, type NextStep } from "../inquiries/model";
import { markClosed, markFollowedUp, markReplied, reopen, useInquiryProgress } from "../inquiries/state";
import { relative } from "../lib/time";
import "../styles/inquiries.css";

const TICK_MS = 60_000;

/** Opens the draft in KC's own mail app. Nothing is sent from Atlas. */
function openDraft(url: string) {
  if ("__TAURI_INTERNALS__" in window) void import("@tauri-apps/plugin-opener").then((m) => m.openUrl(url));
  else window.location.href = url;
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
      {inbox.state === "error" && <p className="muted small inquiries-note">{inbox.message}</p>}
      {inbox.state === "ready" && !rows.length && <p className="muted small inquiries-note">No website inquiries yet. New ones from the benjaire.com contact form appear here.</p>}
      {rows.length > 0 && (
        <ul className="list">
          {rows.map(({ i, step }) => (
            <InquiryRow key={i.id} inquiry={i} step={step} />
          ))}
        </ul>
      )}
      <div className="card-foot muted small">
        Drafts are fixed templates and open in your own mail app, so nothing reaches a client until you press Send there. Progress is kept on this device. No AI calls, no cost.
      </div>
    </section>
  );
}

function InquiryRow({ inquiry: i, step }: { inquiry: Inquiry; step: NextStep }) {
  const chip = stepChip(step);
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
              <button className="btn small" onClick={() => openDraft(mailto(i.email, replyDraft(i)))} title="Open a drafted reply in your mail app">
                Draft reply
              </button>
              <button className="text-btn small" onClick={() => markReplied(i.id)} title="You sent the reply; follow-ups are due on day 3 and day 7">
                Mark replied
              </button>
            </>
          )}
          {step.kind === "follow_up" && (
            <>
              <button className={step.due ? "btn small" : "btn small quiet"} onClick={() => openDraft(mailto(i.email, followUpDraft(i, step.number)))} title="Open a drafted follow-up in your mail app">
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
    </li>
  );
}
