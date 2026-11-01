import { describe, expect, it } from "vitest";
import { sample } from "./fixtures";
import { firstName, followUpDraft, mailto, nextStep, replyDraft, validInquiry } from "./model";


const T0 = Date.parse("2026-11-01T06:00:00.000Z");
const DAY = 86_400_000;

describe("validating inquiries", () => {
  it("accepts what the Worker sends", () => expect(validInquiry(sample())).toBe(true));
  it("refuses bad ids, emails, dates, empty names and long messages", () => {
    expect(validInquiry(sample({ id: "../x" }))).toBe(false);
    expect(validInquiry(sample({ email: "nope" }))).toBe(false);
    expect(validInquiry(sample({ received_at: "yesterday" }))).toBe(false);
    expect(validInquiry(sample({ name: "" }))).toBe(false);
    expect(validInquiry(sample({ message: "x".repeat(5001) }))).toBe(false);
    expect(validInquiry({ ...sample(), name: 5 })).toBe(false);
    expect(validInquiry(null)).toBe(false);
  });
});

describe("next step", () => {
  const i = sample();
  it("asks for a reply, overdue after a day", () => {
    expect(nextStep(i, undefined, T0 + 3_600_000)).toEqual({ kind: "reply", overdue: false });
    expect(nextStep(i, undefined, T0 + DAY + 1)).toEqual({ kind: "reply", overdue: true });
  });
  it("schedules follow-ups on day 3 and day 7 after the reply", () => {
    const replied = { stage: "replied" as const, repliedAt: new Date(T0).toISOString(), followUps: 0 };
    expect(nextStep(i, replied, T0 + 2 * DAY)).toMatchObject({ kind: "follow_up", number: 1, due: false });
    expect(nextStep(i, replied, T0 + 3 * DAY)).toMatchObject({ kind: "follow_up", number: 1, due: true });
    expect(nextStep(i, { ...replied, followUps: 1 }, T0 + 5 * DAY)).toMatchObject({ kind: "follow_up", number: 2, due: false, dueAt: new Date(T0 + 7 * DAY).toISOString() });
    expect(nextStep(i, { ...replied, followUps: 2 }, T0 + 30 * DAY)).toEqual({ kind: "done" });
  });
  it("stops when closed", () => expect(nextStep(i, { stage: "closed" }, T0)).toEqual({ kind: "done" }));
});

describe("drafts", () => {
  it("greets by first name, quotes the message and asks the category's questions", () => {
    const d = replyDraft(sample());
    expect(d.subject).toBe("Re: your Digital Solutions inquiry");
    expect(d.body.startsWith("Hi Alex,")).toBe(true);
    expect(d.body).toContain('at Factory Co: "We want to automate');
    expect(d.body).toContain("budget range");
  });
  it("falls back to the general template and shortens long messages", () => {
    const d = replyDraft(sample({ category: "other", category_label: "Other", company: "", message: "y".repeat(400) }));
    expect(d.body).toContain("Thanks for getting in touch");
    expect(d.body).toContain("...\"");
    expect(d.body).not.toContain(" at :");
  });
  it("has two follow-ups, the second closes the loop", () => {
    expect(followUpDraft(sample(), 1).body).toContain("following up");
    expect(followUpDraft(sample(), 2).body).toContain("close out");
  });
  it("builds an encoded mailto link", () => {
    const url = mailto("a+b@x.example", { subject: "Re: hi & bye", body: "line 1\nline 2" });
    expect(url).toBe("mailto:a%2Bb%40x.example?subject=Re%3A%20hi%20%26%20bye&body=line%201%0Aline%202");
  });
  it("first name copes with blanks", () => expect(firstName("   ")).toBe("there"));
});
