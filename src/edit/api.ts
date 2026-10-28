import { useEffect, useState } from "react";
import { useActions } from "../actions/state";
import type { ActionsStatus } from "../actions/types";
import { githubGet } from "../github/transport";
import { isHostedWeb, isTauri } from "../lib/env";
import { encodePath, MAX_FILE_BYTES, type EditOutcome, type EditRequest } from "../../server/editRules";

export type { EditOutcome, EditRequest };

/** The repository that holds the catalog manifests, so catalog edits open pull requests here. */
export const CATALOG_REPO = "khaneilcampbell/ai-ops-atlas";
export const catalogPath = (file: string) => `catalog/${file}`;

export interface RepoFile {
  repo: string;
  path: string;
  /** The blob sha GitHub reported; the edit names it so a newer version on GitHub wins. */
  sha: string;
  text: string;
  url: string | null;
}

export interface DirEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
}

type J = Record<string, unknown>;

function decode(b64: string): string | null {
  try {
    const bytes = Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.includes("\0") ? null : text;
  } catch {
    return null;
  }
}

/** A text file on the repository's default branch, read through the same read-only path as everything else. */
export async function readFile(repo: string, path: string): Promise<RepoFile> {
  const body = (await githubGet(`/repos/${repo}/contents/${encodePath(path)}`)) as J | J[] | null;
  if (!body || Array.isArray(body)) throw new Error(`${path} is a folder, not a file.`);
  if (body.type !== "file") throw new Error(`${path} isn't a regular file.`);
  if (typeof body.size === "number" && body.size > MAX_FILE_BYTES) throw new Error(`${path} is over ${MAX_FILE_BYTES / 1024} KB, too large to edit in Atlas.`);
  const text = decode(String(body.content ?? ""));
  if (text === null) throw new Error(`${path} isn't a text file, so Atlas can't edit it.`);
  return { repo, path, sha: String(body.sha), text, url: typeof body.html_url === "string" ? body.html_url : null };
}

/** One folder of the default branch, folders first. */
export async function listDir(repo: string, dir: string): Promise<DirEntry[]> {
  const body = await githubGet(`/repos/${repo}/contents${dir ? `/${encodePath(dir)}` : ""}`);
  if (!Array.isArray(body)) throw new Error(`${dir || "The repository root"} isn't a folder.`);
  return (body as J[])
    .filter((e) => e.type === "file" || e.type === "dir")
    .map((e) => ({ name: String(e.name), path: String(e.path), type: e.type as "file" | "dir", size: Number(e.size) || 0 }))
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
}

/** Text formats the editor opens. Anything else (images, archives, lock files) stays on GitHub. */
const TEXT_EXT = /\.(md|mdx|markdown|txt|rst|ya?ml|json|jsonc|toml|ini|cfg|conf|env\.example|csv|tsv|html?|css|xml|svg|astro|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|sh|sql)$/i;
const TEXT_NAMES = new Set(["readme", "license", "notice", "codeowners", "changelog", "dockerfile", "makefile", "procfile", ".gitignore", ".editorconfig", ".nvmrc"]);
const SKIP = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|cargo\.lock)$/i;

export function editableName(path: string): boolean {
  const name = path.split("/").pop()!.toLowerCase();
  return !SKIP.test(path) && (TEXT_EXT.test(name) || TEXT_NAMES.has(name));
}

/** Whether this build can send edits at all, and to which repositories. */
export interface EditAccess {
  /** Where edits go: the Mac app's native flow, or the hosted site's function. */
  via: "desktop" | "web" | "none";
  repos: string[];
  /** Why nothing can be sent, when nothing can. */
  reason: string | null;
}

export function desktopAccess(status: ActionsStatus | null): EditAccess {
  const sw = status?.config.edit_files;
  if (!status || !sw?.enabled) return { via: "desktop", repos: [], reason: "Editing is off. Turn it on in Settings → Actions → Edit files." };
  const tokens = status.merge_tokens ?? [];
  const repos = sw.repos.filter((r) => tokens.includes(r.toLowerCase()));
  return { via: "desktop", repos, reason: repos.length ? null : "No repository is enabled for edits yet. Tick one in Settings → Actions → Edit files." };
}

let webAccess: Promise<EditAccess> | null = null;

async function fetchWebAccess(): Promise<EditAccess> {
  try {
    const r = await fetch("/api/edit", { credentials: "same-origin", headers: { Accept: "application/json" } });
    const b = (await r.json()) as { enabled?: boolean; repos?: string[] };
    const repos = Array.isArray(b.repos) ? b.repos : [];
    return { via: "web", repos, reason: b.enabled && repos.length ? null : "Editing from the website is off. It needs GITHUB_EDIT_TOKEN and EDIT_REPOS on the Cloudflare Pages project (docs/editing.md)." };
  } catch {
    return { via: "web", repos: [], reason: "Couldn't ask the site whether editing is on." };
  }
}

/** Edit access for this build, kept fresh with the desktop app's settings. */
export function useEditAccess(): EditAccess | null {
  const { status } = useActions();
  const [web, setWeb] = useState<EditAccess | null>(null);
  useEffect(() => {
    if (!isHostedWeb()) return;
    void (webAccess ??= fetchWebAccess()).then(setWeb);
  }, []);
  if (isTauri()) return desktopAccess(status);
  if (isHostedWeb()) return web;
  return { via: "none", repos: [], reason: "Editing works in the Mac app and the signed-in website." };
}

export function canEdit(access: EditAccess | null, repo: string): boolean {
  return !!access && access.repos.some((r) => r.toLowerCase() === repo.toLowerCase());
}

/**
 * Sends one edit. In the Mac app the Rust side checks the file again, asks in a native dialog
 * and logs the attempt before anything reaches GitHub; on the website the site's function does
 * the same checks with its own token. Either way: a new branch and a pull request, never main.
 */
export async function proposeEdit(req: EditRequest): Promise<EditOutcome> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<EditOutcome>("action_propose_edit", { request: req });
  }
  const r = await fetch("/api/edit", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-Atlas-Edit": "1" },
    body: JSON.stringify(req),
  });
  const body = (await r.json().catch(() => null)) as EditOutcome | null;
  if (body && typeof body.message === "string") return body;
  return { stage: "failed", reason: "site_error", message: `The site answered ${r.status}. Nothing was confirmed; check GitHub before trying again.`, pull_number: null, pull_url: null, branch: null };
}
