/**
 * Copies text to the clipboard. Uses the async Clipboard API where the page allows it, and
 * falls back to a hidden textarea + execCommand("copy") for webviews or pages that refuse it
 * (older WKWebView, plain-http previews). The fallback is shaped for iOS Safari: a 16px font
 * so focusing it doesn't zoom the page, and an explicit selection range because select()
 * alone selects nothing there.
 */
export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall through to the textarea copy.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.opacity = "0";
  area.style.fontSize = "16px";
  area.style.userSelect = "text";
  area.style.webkitUserSelect = "text";
  const active = document.activeElement as HTMLElement | null;
  document.body.appendChild(area);
  area.focus({ preventScroll: true });
  area.select();
  area.setSelectionRange(0, text.length);
  let ok: boolean;
  try {
    ok = document.execCommand("copy");
  } finally {
    area.remove();
    active?.focus?.({ preventScroll: true });
  }
  if (!ok) throw new Error("Copy was blocked");
}
