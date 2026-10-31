import { isTauri } from "../lib/env";

// System notifications for agent alerts: the notification plugin in the Mac app, the browser's
// Notification API on the website. On iPhone, Safari only allows them for a site added to the
// Home Screen (iOS 16.4 or later); elsewhere the alert still shows inside Atlas.

export type Permission = "granted" | "denied" | "default" | "unsupported";

export async function permission(): Promise<Permission> {
  if (isTauri()) {
    const n = await import("@tauri-apps/plugin-notification");
    return (await n.isPermissionGranted()) ? "granted" : "default";
  }
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

/** Asks the system, which shows its own prompt the first time. */
export async function requestPermission(): Promise<Permission> {
  if (isTauri()) {
    const n = await import("@tauri-apps/plugin-notification");
    return (await n.requestPermission()) as Permission;
  }
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.requestPermission();
}

export async function notify(title: string, body: string): Promise<void> {
  if (isTauri()) {
    const n = await import("@tauri-apps/plugin-notification");
    if (await n.isPermissionGranted()) n.sendNotification({ title, body });
    return;
  }
  if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(title, { body, tag: title });
}
