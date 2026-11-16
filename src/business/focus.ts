// Which Business tab to open next, when another view (a building panel, a workflow step) sends
// Khaneil there. Read once by the Business view.

export type BusinessTab = "overview" | "goals" | "pipeline" | "products" | "finance" | "impact" | "advisor";

let pending: BusinessTab | null = null;
export const focusBusinessTab = (t: BusinessTab) => void (pending = t);
export function takeBusinessTab(): BusinessTab | null {
  const t = pending;
  pending = null;
  return t;
}
