import { STATUSES, type HistoryEntry, type Link, type ManifestIssue, type Status } from "./types";

export const REPO_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
export const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export type Raw = Record<string, unknown>;

/** Collects manifest problems instead of throwing. */
export class Reader {
  constructor(
    private file: string,
    private issues: ManifestIssue[],
  ) {}

  fail(path: string, message: string) {
    this.issues.push({ file: this.file, message: `${path}: ${message}` });
  }

  obj(v: unknown, path: string): Raw | null {
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Raw;
    this.fail(path, "expected a mapping");
    return null;
  }

  str(o: Raw, key: string, path: string, required = true): string | undefined {
    const v = o[key];
    if (v === undefined || v === null) {
      if (required) this.fail(`${path}.${key}`, "is required");
      return undefined;
    }
    if (typeof v !== "string" || !v.trim()) {
      this.fail(`${path}.${key}`, "must be a non-empty string");
      return undefined;
    }
    return v.trim();
  }

  id(o: Raw, path: string): string | undefined {
    const v = this.str(o, "id", path);
    if (v && !ID_RE.test(v)) this.fail(`${path}.id`, "use lowercase letters, digits and dashes");
    return v;
  }

  status(o: Raw, path: string): Status {
    const v = this.str(o, "status", path);
    if (v && (STATUSES as readonly string[]).includes(v)) return v as Status;
    if (v) this.fail(`${path}.status`, `must be one of ${STATUSES.join(", ")}`);
    return "idle";
  }

  date(o: Raw, key: string, path: string): string | null {
    const v = o[key];
    if (v === undefined || v === null) return null;
    // YAML parses bare timestamps into Date objects.
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString();
    this.fail(`${path}.${key}`, "must be an ISO date or null");
    return null;
  }

  bool(o: Raw, key: string, path: string): boolean | undefined {
    const v = o[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v === "boolean") return v;
    this.fail(`${path}.${key}`, "must be true or false");
    return undefined;
  }

  /** A string that must be one of `values`; unknown values are reported and dropped. */
  oneOf<T extends string>(o: Raw, key: string, path: string, values: readonly T[]): T | undefined {
    const v = this.str(o, key, path, false);
    if (v === undefined) return undefined;
    if ((values as readonly string[]).includes(v)) return v as T;
    this.fail(`${path}.${key}`, `must be one of ${values.join(", ")}`);
    return undefined;
  }

  list(o: Raw, key: string, path: string): unknown[] {
    const v = o[key];
    if (v === undefined || v === null) return [];
    if (Array.isArray(v)) return v;
    this.fail(`${path}.${key}`, "expected a list");
    return [];
  }

  links(o: Raw, path: string): Link[] {
    return this.list(o, "links", path).flatMap((l, i) => {
      const lo = this.obj(l, `${path}.links[${i}]`);
      if (!lo) return [];
      const label = this.str(lo, "label", `${path}.links[${i}]`);
      const url = this.str(lo, "url", `${path}.links[${i}]`);
      if (!label || !url) return [];
      if (!/^https:\/\//.test(url)) {
        this.fail(`${path}.links[${i}].url`, "must be an https URL");
        return [];
      }
      return [{ label, url }];
    });
  }

  strings(o: Raw, key: string, path: string): string[] {
    return this.list(o, key, path).flatMap((v, i) => {
      if (typeof v === "string" && v.trim()) return [v.trim()];
      this.fail(`${path}.${key}[${i}]`, "must be a non-empty string");
      return [];
    });
  }

  history(o: Raw, path: string): HistoryEntry[] {
    return this.list(o, "history", path).flatMap((h, i) => {
      const ho = this.obj(h, `${path}.history[${i}]`);
      if (!ho) return [];
      const at = this.date(ho, "at", `${path}.history[${i}]`);
      const event = this.str(ho, "event", `${path}.history[${i}]`);
      return at && event ? [{ at, event }] : [];
    });
  }
}

