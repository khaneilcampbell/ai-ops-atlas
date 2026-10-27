// Small stroke icon set (24px grid, Lucide-style) so the app ships without an icon dependency.
const PATHS: Record<string, string> = {
  overview: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
  agents: "M12 8V4H8M4 8h16v12H4zM2 14h2M20 14h2M15 13v2M9 13v2",
  repos: "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9",
  map: "M14.1 5.9 9 3 3 5.9v15l6-2.9 5.1 2.9 6-2.9v-15zM9 3v15M15 6v15",
  settings: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  refresh: "M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M8 16H3v5",
  close: "M18 6 6 18M6 6l12 12",
  external: "M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  focus: "M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M12 12h.01",
  tag: "M12 2H2v10l9.3 9.3a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4zM7 7h.01",
  alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  commit: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 12h6M15 12h6",
  play: "M6 3l14 9-14 9z",
  check: "M20 6 9 17l-5-5",
  pause: "M6 4h4v16H6zM14 4h4v16h-4z",
  circle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  key: "M2.6 18.4 2 22h4v-2h2v-2h2l1.4-1.4a6.5 6.5 0 1 0-4-4zM16.5 7.5h.01",
  compass: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM16.2 7.8l-2.1 6.4-6.4 2.1 2.1-6.4z",
  labels: "M4 7V4h16v3M9 20h6M12 4v16",
  lock: "M5 11h14v10H5zM7 11V7a5 5 0 0 1 10 0v4",
  pulse: "M22 12h-4l-3 9L9 3l-3 9H2",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function AtlasMark({ size = 22 }: { size?: number }) {
  // Compass rose inside an acorn-like arch: a nod to the reference, drawn for this app.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 10a8 8 0 0 1 16 0" />
      <path d="M4 10h16" />
      <path d="M6 10c0 6 3 10 6 11 3-1 6-5 6-11" />
      <path d="M12 12.5l1.4 3.1-1.4 2.4-1.4-2.4z" fill="currentColor" stroke="none" />
      <path d="M12 2v1.6" />
    </svg>
  );
}
