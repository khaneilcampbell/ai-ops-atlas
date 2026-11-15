import { describe, expect, it } from "vitest";
import { updateLabel } from "./UpdateButton";

describe("updateLabel", () => {
  it("offers the update until it is pressed", () => {
    expect(updateLabel({ busy: false })).toBe("Update available");
  });

  it("shows download progress, then that Atlas is restarting", () => {
    expect(updateLabel({ busy: true })).toBe("Updating…");
    expect(updateLabel({ busy: true, pct: 42 })).toBe("Updating… 42%");
    expect(updateLabel({ busy: true, pct: 100 })).toBe("Updating, restarting…");
  });

  it("offers a retry after a failure", () => {
    expect(updateLabel({ busy: false, error: "offline" })).toBe("Update failed, retry");
  });
});
