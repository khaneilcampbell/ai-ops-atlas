// A line diff for the review step: exactly what an edit will change, before anything is sent.
// Common lines at the start and end are trimmed, then the longest common subsequence of the
// rest decides what was kept. No dependency, and files the editor accepts are small.

export interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
  /** Line number in the old file (same and del) or the new file (add). */
  oldNo: number | null;
  newNo: number | null;
}

export interface Hunk {
  lines: DiffLine[];
}

export interface Diff {
  added: number;
  removed: number;
  hunks: Hunk[];
}

const split = (t: string) => (t === "" ? [] : t.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n"));

/** Above this many cells the middle is shown as replaced rather than matched line by line. */
const MAX_CELLS = 4_000_000;

export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = split(oldText);
  const b = split(newText);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const am = a.slice(start, a.length - end);
  const bm = b.slice(start, b.length - end);

  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ kind: "same", text: a[i], oldNo: i + 1, newNo: i + 1 });

  if (am.length * bm.length > MAX_CELLS) {
    am.forEach((t, i) => out.push({ kind: "del", text: t, oldNo: start + i + 1, newNo: null }));
    bm.forEach((t, j) => out.push({ kind: "add", text: t, oldNo: null, newNo: start + j + 1 }));
  } else {
    // lcs[i][j] = common lines in am[i..] and bm[j..]
    const w = bm.length + 1;
    const lcs = new Uint32Array((am.length + 1) * w);
    for (let i = am.length - 1; i >= 0; i--)
      for (let j = bm.length - 1; j >= 0; j--) lcs[i * w + j] = am[i] === bm[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    let i = 0;
    let j = 0;
    while (i < am.length || j < bm.length) {
      if (i < am.length && j < bm.length && am[i] === bm[j]) {
        out.push({ kind: "same", text: am[i], oldNo: start + i + 1, newNo: start + j + 1 });
        i++;
        j++;
      } else if (i < am.length && (j === bm.length || lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) {
        out.push({ kind: "del", text: am[i], oldNo: start + i + 1, newNo: null });
        i++;
      } else {
        out.push({ kind: "add", text: bm[j], oldNo: null, newNo: start + j + 1 });
        j++;
      }
    }
  }

  for (let k = 0; k < end; k++) {
    const oi = a.length - end + k;
    const ni = b.length - end + k;
    out.push({ kind: "same", text: a[oi], oldNo: oi + 1, newNo: ni + 1 });
  }
  return out;
}

/** The changed lines with `context` unchanged lines around each change, grouped into hunks. */
export function diff(oldText: string, newText: string, context = 3): Diff {
  const lines = lineDiff(oldText, newText);
  const added = lines.filter((l) => l.kind === "add").length;
  const removed = lines.filter((l) => l.kind === "del").length;
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.kind === "same") return;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
  });
  const hunks: Hunk[] = [];
  let cur: DiffLine[] | null = null;
  lines.forEach((l, i) => {
    if (!keep[i]) {
      cur = null;
      return;
    }
    if (!cur) hunks.push({ lines: (cur = []) });
    cur.push(l);
  });
  return { added, removed, hunks };
}
