import { describe, expect, it } from "vitest";
import { repositoryHelp } from "./repositoryHelp";
import { PRIVATE_OR_MISSING } from "../github/transport";

describe("platform-specific repository connection guidance", () => {
  it("does not ask a local preview user to enter a token it cannot save", () => {
    const help = repositoryHelp(PRIVATE_OR_MISSING, "preview");
    expect(help.title).toContain("preview");
    expect(help.detail).toContain("public repositories only");
    expect(help.detail).toContain("desktop app");
    expect(help.detail).toContain("renamed");
  });
  it("routes hosted access problems to the server owner", () => {
    const help = repositoryHelp(PRIVATE_OR_MISSING, "hosted");
    expect(help.detail).toContain("Cloudflare");
    expect(help.detail).toContain("never entered into this browser");
  });
  it("routes desktop access problems to its saved read-only token", () => {
    expect(repositoryHelp(PRIVATE_OR_MISSING, "desktop").detail).toContain("saved token");
    expect(repositoryHelp(PRIVATE_OR_MISSING, "desktop").detail).toContain("read-only");
  });
  it("preserves other actionable transport errors", () => {
    expect(repositoryHelp("The saved GitHub token was rejected", "desktop").detail).toBe("The saved GitHub token was rejected");
  });
});

it("explains missing cached data without claiming a fetch is in progress",()=>{
 const help=repositoryHelp("No repository snapshot","preview");
 expect(help.title).toBe("No GitHub evidence yet");
 expect(help.detail).toContain("cannot read private repositories");
 expect(help.detail).toContain("Refresh");
});
