// Theme: light, dark, or follow the system. Stored per browser only.
export type ThemePref = 'light' | 'dark' | 'system';

const media = () => window.matchMedia('(prefers-color-scheme: dark)');

export function readPref(): ThemePref {
  try {
    const v = localStorage.getItem('ops.theme');
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function savePref(t: ThemePref) {
  try {
    localStorage.setItem('ops.theme', t);
  } catch {
    /* storage unavailable */
  }
}

export function applyTheme(t: ThemePref = readPref()) {
  const dark = t === 'dark' || (t === 'system' && media().matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function watchSystemTheme() {
  media().addEventListener('change', () => readPref() === 'system' && applyTheme('system'));
}
