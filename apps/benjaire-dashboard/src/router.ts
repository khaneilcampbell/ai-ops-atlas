// Minimal history router: the dashboard has a fixed set of pages, so a
// library would add weight without adding anything.
import { useEffect, useState } from 'preact/hooks';

const listeners = new Set<() => void>();

export function navigate(to: string, replace = false) {
  if (to === location.pathname + location.search) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', to);
  listeners.forEach((l) => l());
}

export function useLocation(): URL {
  const [url, setUrl] = useState(() => new URL(location.href));
  useEffect(() => {
    const update = () => setUrl(new URL(location.href));
    listeners.add(update);
    addEventListener('popstate', update);
    return () => {
      listeners.delete(update);
      removeEventListener('popstate', update);
    };
  }, []);
  return url;
}

/** Same-origin link clicks become client-side navigation. */
export function onLinkClick(e: MouseEvent) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element).closest('a');
  if (!a || a.target || a.origin !== location.origin || a.hasAttribute('download')) return;
  e.preventDefault();
  navigate(a.pathname + a.search);
}
