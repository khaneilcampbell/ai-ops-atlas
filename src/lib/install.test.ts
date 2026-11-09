import { describe, expect, it } from "vitest";
import { shouldSuggestInstall } from "./install";

describe("shouldSuggestInstall", () => {
  const base = { tauri: false, phone: true, standalone: false, dismissed: false };
  it("suggests in a phone browser", () => expect(shouldSuggestInstall(base)).toBe(true));
  it("not once added to the Home Screen", () => expect(shouldSuggestInstall({ ...base, standalone: true })).toBe(false));
  it("not after dismissing", () => expect(shouldSuggestInstall({ ...base, dismissed: true })).toBe(false));
  it("not on a desktop browser", () => expect(shouldSuggestInstall({ ...base, phone: false })).toBe(false));
  it("not in the Mac app", () => expect(shouldSuggestInstall({ ...base, tauri: true })).toBe(false));
});
