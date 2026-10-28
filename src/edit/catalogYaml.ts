// Field edits to a catalog manifest that change only the lines they touch. Comments, folded
// summaries and key order elsewhere in the file stay exactly as written, so the diff KC
// reviews shows the edit and nothing else. Every result is parsed again and compared with the
// intended data; anything that doesn't match is refused rather than sent.

import jsyaml from "js-yaml";
import { isMap, isScalar, isSeq, parseDocument, stringify, type Node, type Pair, type YAMLMap } from "yaml";
import { parseManifest } from "../catalog/parse";
import { STATUSES, type Link, type ManifestIssue, type Status } from "../catalog/types";

export type FieldPath = (string | number)[];
/** `null` removes an optional field. */
export type FieldValue = string | Link[] | null;

export interface FieldEdit {
  path: FieldPath;
  value: FieldValue;
}

type Range = [number, number, number];
const range = (n: unknown): Range | null => ((n as { range?: Range } | null)?.range ?? null);

function lineStart(text: string, pos: number): number {
  return text.lastIndexOf("\n", pos - 1) + 1;
}

/** The position just after the line holding `pos` (after its newline, or the end of the text). */
function afterLine(text: string, pos: number): number {
  const nl = text.indexOf("\n", pos);
  return nl === -1 ? text.length : nl + 1;
}

const column = (text: string, pos: number) => pos - lineStart(text, pos);

/** A value rendered for the text after `key:`, with continuation lines at `indent`. */
function render(value: string | Link[], indent: number): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return " []";
    const body = stringify(
      value.map((l) => ({ label: l.label, url: l.url })),
      { lineWidth: 0 },
    ).replace(/\n$/, "");
    return "\n" + body.split("\n").map((l) => " ".repeat(indent) + l).join("\n");
  }
  // Long single-paragraph text is folded the way the manifests already write summaries.
  if (value.length > 80 && !/\n|\s\s|^\s|\s$/.test(value)) {
    const lines: string[] = [];
    let cur = "";
    for (const w of value.split(" ")) {
      if (cur && cur.length + 1 + w.length > 76) {
        lines.push(cur);
        cur = w;
      } else cur = cur ? `${cur} ${w}` : w;
    }
    lines.push(cur);
    return " >-\n" + lines.map((l) => " ".repeat(indent) + l).join("\n");
  }
  let s = stringify(value, { lineWidth: 0 }).replace(/\n$/, "");
  // The app reads manifests with js-yaml, which turns some plain words (dates, for one) into
  // other types. Quote those so the value stays the text that was typed.
  if (!s.includes("\n")) {
    const read = (jsyaml.load(`v: ${s}`, { schema: jsyaml.DEFAULT_SCHEMA }) as { v: unknown } | null)?.v;
    if (read !== value) s = JSON.stringify(value);
  }
  const [first, ...rest] = s.split("\n");
  return " " + [first, ...rest.map((l) => " ".repeat(indent) + l)].join("\n");
}

function pairOf(map: YAMLMap, key: string | number): Pair<Node, Node | null> | undefined {
  return map.items.find((p) => isScalar(p.key) && p.key.value === key) as Pair<Node, Node | null> | undefined;
}

/** The map or sequence item at `path`, or null when part of it is missing. */
function nodeAt(doc: ReturnType<typeof parseDocument>, path: FieldPath): Node | null {
  if (path.length === 0) return doc.contents as Node | null;
  return (doc.getIn(path, true) as Node | undefined) ?? null;
}

function nested(keys: FieldPath, value: string | Link[]): unknown {
  return keys.reduceRight<unknown>((v, k) => ({ [k]: v }), Array.isArray(value) ? value.map((l) => ({ label: l.label, url: l.url })) : value);
}

/** Applies one edit to the text, touching only the lines it changes. */
function applyOne(text: string, edit: FieldEdit): string {
  const doc = parseDocument(text);
  if (doc.errors.length) throw new Error(`The manifest isn't valid YAML: ${doc.errors[0].message}`);
  const key = edit.path[edit.path.length - 1];
  const parentPath = edit.path.slice(0, -1);
  const parent = nodeAt(doc, parentPath);

  if (parent && isMap(parent)) {
    const pair = pairOf(parent, key);
    if (pair) {
      const kr = range(pair.key)!;
      const vr = range(pair.value);
      if (edit.value === null) {
        // Remove the whole entry: from its line to the end of its value.
        const from = lineStart(text, kr[0]);
        const to = afterLine(text, Math.max((vr?.[2] ?? kr[2]) - 1, kr[0]));
        return text.slice(0, from) + text.slice(to);
      }
      const colon = text.indexOf(":", kr[1]);
      let end = vr ? vr[1] : colon + 1;
      if (end > colon + 1 && text[end - 1] === "\n") end--;
      return text.slice(0, colon + 1) + render(edit.value, column(text, kr[0]) + 2) + text.slice(end);
    }
    if (edit.value === null) return text;
    // A new key: after the map's last entry, at the indentation of its first key.
    const last = parent.items[parent.items.length - 1];
    if (!last) throw new Error(`Can't add ${String(key)} to an empty block.`);
    const indent = column(text, range(parent.items[0].key)![0]);
    const lastEnd = range(last.value)?.[2] ?? range(last.key)![2];
    const at = text[lastEnd - 1] === "\n" ? lastEnd : afterLine(text, lastEnd);
    const line = " ".repeat(indent) + String(key) + ":" + render(edit.value, indent + 2) + "\n";
    const pre = text.slice(0, at);
    return (pre.endsWith("\n") ? pre : pre + "\n") + line + text.slice(at);
  }

  if (edit.value === null) return text;
  // Part of the path is missing: add the missing blocks under the deepest map that exists.
  for (let n = parentPath.length - 1; n >= 0; n--) {
    const anc = nodeAt(doc, parentPath.slice(0, n));
    if (!anc) continue;
    if (!isMap(anc) || anc.items.length === 0) break;
    const indent = column(text, range(anc.items[0].key)![0]);
    const block = stringify(nested(edit.path.slice(n), edit.value), { lineWidth: 0 })
      .replace(/\n$/, "")
      .split("\n")
      .map((l) => " ".repeat(indent) + l)
      .join("\n");
    const last = anc.items[anc.items.length - 1];
    const lastEnd = range(last.value)?.[2] ?? range(last.key)![2];
    const at = text[lastEnd - 1] === "\n" ? lastEnd : afterLine(text, lastEnd);
    const pre = text.slice(0, at);
    return (pre.endsWith("\n") ? pre : pre + "\n") + block + "\n" + text.slice(at);
  }
  throw new Error(`Can't find where ${edit.path.join(".")} belongs in the manifest.`);
}

/** Deep equality for plain parsed YAML data. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function setIn(data: unknown, path: FieldPath, value: unknown) {
  let cur = data as Record<string | number, unknown>;
  for (const k of path.slice(0, -1)) {
    if (cur[k] === undefined || cur[k] === null) cur[k] = {};
    cur = cur[k] as Record<string | number, unknown>;
  }
  const last = path[path.length - 1];
  if (value === null) delete cur[last];
  else cur[last] = value;
}

export interface CatalogEditResult {
  text: string;
  /** Problems the app's own validator finds in the new text that the old text didn't have. */
  issues: ManifestIssue[];
}

/**
 * Applies the edits and checks the result: the new text must parse to exactly the old data
 * with these fields changed, and pass the catalog validator without new problems.
 */
export function editManifest(file: string, text: string, edits: FieldEdit[]): CatalogEditResult {
  let out = text;
  for (const e of edits) out = applyOne(out, e);
  const expected = parseDocument(text).toJS();
  for (const e of edits) setIn(expected, e.path, Array.isArray(e.value) ? e.value.map((l) => ({ label: l.label, url: l.url })) : e.value);
  const actual = parseDocument(out).toJS();
  if (!same(expected, actual)) throw new Error("Atlas couldn't make this edit without changing other parts of the manifest, so it wasn't applied.");
  const before: ManifestIssue[] = [];
  parseManifest(file, text, before);
  const after: ManifestIssue[] = [];
  parseManifest(file, out, after);
  const known = new Set(before.map((i) => i.message));
  return { text: out, issues: after.filter((i) => !known.has(i.message)) };
}

/** Where an agent sits in its manifest's `agents` list, by id. */
export function agentIndex(text: string, id: string): number {
  const doc = parseDocument(text);
  const agents = doc.get("agents", true);
  if (!isSeq(agents)) return -1;
  return agents.items.findIndex((a) => isMap(a) && (a as YAMLMap).get("id") === id);
}

/** The fields the editor offers, read from the manifest text itself. */
export interface EditableFields {
  name: string;
  /** Agents only: the registry's display title (atlas/v2). */
  title?: string;
  /** `purpose` for agents, `summary` for projects. */
  description: string;
  status: Status;
  trigger?: string;
  schedule?: string;
  owner?: string;
  links: Link[];
}

const str = (v: unknown) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));

export function readFields(text: string, target: { kind: "project" } | { kind: "agent"; id: string }): { fields: EditableFields; base: FieldPath; v2: boolean } | null {
  const data = parseDocument(text).toJS() as Record<string, unknown> | null;
  if (!data) return null;
  const v2 = data.schema === "atlas/v2";
  const links = (v: unknown): Link[] => (Array.isArray(v) ? v.filter((l) => l && typeof l === "object").map((l) => ({ label: str(l.label), url: str(l.url) })) : []);
  const status = (v: unknown): Status => ((STATUSES as readonly unknown[]).includes(v) ? (v as Status) : "active");
  if (target.kind === "project") {
    const p = data.project as Record<string, unknown> | undefined;
    if (!p) return null;
    return { base: ["project"], v2, fields: { name: str(p.name), description: str(p.summary), status: status(p.status), links: links(p.links) } };
  }
  const i = agentIndex(text, target.id);
  if (i < 0) return null;
  const a = (data.agents as Record<string, unknown>[])[i];
  const reg = (a.registry ?? {}) as Record<string, Record<string, unknown> | string | undefined>;
  const sub = (k: string, f: string) => str((reg[k] as Record<string, unknown> | undefined)?.[f]);
  return {
    base: ["agents", i],
    v2,
    fields: {
      name: str(a.name),
      title: str(reg.title),
      description: str(a.purpose),
      status: status(a.status),
      trigger: str(a.trigger),
      schedule: sub("execution", "schedule"),
      owner: sub("governance", "credential_owner"),
      links: links(a.links),
    },
  };
}

const sameLinks = (a: Link[], b: Link[]) => a.length === b.length && a.every((l, i) => l.label === b[i].label && l.url === b[i].url);

/** The edits that turn `before` into `after`. Blank optional fields are removed. */
export function fieldEdits(base: FieldPath, kind: "project" | "agent", before: EditableFields, after: EditableFields, v2: boolean): FieldEdit[] {
  const out: FieldEdit[] = [];
  const opt = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
  const put = (path: FieldPath, a: string | undefined, b: string | undefined, required = false) => {
    if ((a ?? "").trim() === (b ?? "").trim()) return;
    const v = required ? (b ?? "").trim() : opt(b);
    if (required && !v) throw new Error(`${String(path[path.length - 1])} can't be empty.`);
    out.push({ path: [...base, ...path], value: v });
  };
  put(["name"], before.name, after.name, true);
  put([kind === "project" ? "summary" : "purpose"], before.description, after.description, true);
  if (before.status !== after.status) out.push({ path: [...base, "status"], value: after.status });
  if (kind === "agent") {
    put(["trigger"], before.trigger, after.trigger);
    if (v2) {
      put(["registry", "title"], before.title, after.title);
      put(["registry", "execution", "schedule"], before.schedule, after.schedule);
      put(["registry", "governance", "credential_owner"], before.owner, after.owner);
    }
  }
  const links = after.links.map((l) => ({ label: l.label.trim(), url: l.url.trim() })).filter((l) => l.label || l.url);
  for (const l of links) {
    if (!l.label || !l.url) throw new Error("Each link needs a label and an https:// address.");
    if (!/^https:\/\/\S+$/.test(l.url)) throw new Error(`Links must start with https:// (${l.url}).`);
  }
  if (!sameLinks(before.links, links)) out.push({ path: [...base, "links"], value: links });
  return out;
}
