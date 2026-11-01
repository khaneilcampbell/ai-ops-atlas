import { describe, expect, it } from "vitest";
import { brandedEmailHtml, escapeHtml } from "./emailHtml";

describe("brandedEmailHtml", () => {
  it("wraps the draft in the Benjaire header and footer", () => {
    const html = brandedEmailHtml("Hi Bill,\n\nThanks for writing.");
    expect(html).toContain("https://benjaire.com/brand/email/email-header-banner.png");
    expect(html).toContain("Benjaire &middot; New York, NY");
    expect(html).toContain("contact@benjaire.com");
  });

  it("turns blank lines into paragraphs and single line breaks into <br>", () => {
    const html = brandedEmailHtml("Hi Bill,\n\nBest,\nKC");
    expect(html).toContain('<p style="margin:0 0 14px">Hi Bill,</p>');
    expect(html).toContain('<p style="margin:0 0 14px">Best,<br>KC</p>');
  });

  it("escapes anything a customer could have put in the draft", () => {
    expect(escapeHtml(`<b>"x" & y</b>`)).toBe("&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;");
    const html = brandedEmailHtml(`Re: <script>alert(1)</script>`);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
