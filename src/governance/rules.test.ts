import { describe, expect, it } from "vitest";
import { guardOf, ruleSummary, toBranchRules } from "./rules";

const ruleset = [
  { type: "deletion", ruleset_id: 1 },
  { type: "non_fast_forward", ruleset_id: 1 },
  { type: "pull_request", ruleset_id: 1, parameters: { required_approving_review_count: 0, require_code_owner_review: false } },
  { type: "required_status_checks", ruleset_id: 1, parameters: { required_status_checks: [{ context: "Frontend" }, { context: "Rust" }] } },
  { type: "required_status_checks", ruleset_id: 2, parameters: { required_status_checks: [{ context: "Rust" }, { context: "CodeQL" }] } },
];

describe("branch rules", () => {
  it("reads a ruleset-guarded branch", () => {
    const r = toBranchRules("o/r", "main", ruleset, { protected: true });
    expect(r).toMatchObject({ rulesets: 2, protected: true, pullRequest: { approvals: 0, codeOwners: false }, requiredChecks: ["CodeQL", "Frontend", "Rust"], blocksForcePush: true, blocksDeletion: true });
    expect(guardOf(r)).toBe("guarded");
    expect(ruleSummary(r)).toEqual(["Pull request to merge", "3 required checks", "No force push", "Can't be deleted"]);
  });

  it("calls a branch partly guarded when one of the three is missing", () => {
    expect(guardOf(toBranchRules("o/r", "main", ruleset.filter((x) => x.type !== "deletion"), { protected: true }))).toBe("partial");
  });

  it("knows only that classic protection exists, and flags an open branch", () => {
    expect(guardOf(toBranchRules("o/r", "main", [], { protected: true }))).toBe("classic");
    const open = toBranchRules("o/r", "main", [], { protected: false });
    expect(guardOf(open)).toBe("open");
    expect(ruleSummary(open)).toEqual([]);
    expect(guardOf(toBranchRules("o/r", "main", null, null))).toBe("open");
  });

  it("counts required approvals", () => {
    const r = toBranchRules("o/r", "main", [{ type: "pull_request", ruleset_id: 3, parameters: { required_approving_review_count: 1, require_code_owner_review: true } }], {});
    expect(ruleSummary(r)).toEqual(["1 approval to merge", "Code owner review"]);
  });
});
