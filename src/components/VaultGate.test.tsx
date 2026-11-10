import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UNLOCK_DELAY_MS, VaultLockScreen } from "./VaultGate";

describe("VaultLockScreen", () => {
  it("shows the logo and message, held low, while Touch ID is asked for", () => {
    const html = renderToStaticMarkup(<VaultLockScreen status={null} onUnlock={() => {}} onSkip={() => {}} />);
    expect(html).toContain('class="vault-lock waiting"');
    expect(html).toContain("brand-mark");
    expect(html).toContain("Welcome back.");
    expect(html).toContain("Use Touch ID to unlock your saved GitHub and Anthropic keys.");
    expect(html).not.toContain("Continue without keys");
  });
  it("centres the retry buttons once the prompt is answered", () => {
    const html = renderToStaticMarkup(<VaultLockScreen status={{ state: "declined", error: null }} onUnlock={() => {}} onSkip={() => {}} />);
    expect(html).toContain('class="vault-lock"');
    expect(html).toContain("Unlock with Touch ID");
    expect(html).toContain("Continue without keys");
  });
  it("waits briefly so the screen paints before the Touch ID sheet", () => {
    expect(UNLOCK_DELAY_MS).toBeGreaterThanOrEqual(500);
    expect(UNLOCK_DELAY_MS).toBeLessThanOrEqual(1500);
  });
});
