/** One name pill per group on the 3D map when projects are grouped. */
export interface GroupLabel { key: string; text: string; title: string; district: boolean }

/**
 * Every grouping (district, tag, status) gets the same quiet district pill: the name alone, the
 * count in the tooltip, so a "CLAUDE · 1" tag group never reads like an error badge. One group, or
 * no grouping, gets no pill.
 */
export function groupLabels(hoods: readonly { key: string; label: string; count: number }[]): GroupLabel[] {
  if (hoods.length < 2) return [];
  return hoods.filter((n) => n.label).map((n) => {
    const kind = n.key.startsWith("d:") ? "district" : n.key.startsWith("t:") ? "tag" : n.key.startsWith("s:") ? "status group" : "group";
    return { key: n.key, text: n.label.toUpperCase(), title: `${n.label} ${kind} · ${n.count} ${n.count === 1 ? "project" : "projects"}`, district: kind === "district" };
  });
}
