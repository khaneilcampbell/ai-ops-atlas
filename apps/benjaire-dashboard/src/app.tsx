import { useCallback, useEffect, useState } from 'preact/hooks';
import { api } from './api';
import { Palette } from './components/Palette';
import { Logo } from './components/ui';
import { currentMonth } from './month';
import { MODULES, moduleState } from './modules';
import { Audit } from './pages/Audit';
import { Connections } from './pages/Connections';
import { Finance } from './pages/Finance';
import { ModulePage } from './pages/Module';
import { Overview } from './pages/Overview';
import { useApi } from './hooks';
import { navigate, onLinkClick, useLocation } from './router';
import { applyTheme, readPref, savePref, type ThemePref } from './theme';

const RANGES = [
  ['24h', '24 hours'],
  ['7d', '7 days'],
  ['30d', '30 days'],
  ['90d', '90 days'],
  ['mtd', 'Month to date'],
] as const;

function readCollapsed(): boolean {
  try {
    return localStorage.getItem('ops.sidebar') === 'collapsed';
  } catch {
    return false;
  }
}

export function App() {
  const url = useLocation();
  const conns = useApi(() => api.connections().then((r) => r.connections));
  const me = useApi(() => api.me(), [], 0);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const [theme, setThemeState] = useState<ThemePref>(readPref);

  const setTheme = useCallback((t: ThemePref) => {
    setThemeState(t);
    savePref(t);
    applyTheme(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      }
      if (e.key === 'Escape') setDrawer(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Move focus to the page on navigation so screen readers announce it.
  useEffect(() => {
    setDrawer(false);
    document.getElementById('main')?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [url.pathname]);

  const mod = MODULES.find((m) => m.path === url.pathname);
  useEffect(() => {
    document.title = `${mod?.label ?? 'Not found'} · Benjaire Ops`;
  }, [mod]);

  const range = url.searchParams.get('range') ?? '30d';
  const showRange = !!mod && mod.sources.length > 0 && mod.path !== '/finance';
  const month = url.searchParams.get('month') ?? currentMonth();

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem('ops.sidebar', next ? 'collapsed' : 'open');
    } catch {
      /* storage unavailable: keep it for this visit only */
    }
  };

  let page;
  if (!mod) {
    page = (
      <div class="empty">
        <strong>Page not found</strong>
        <a class="btn" href="/">
          Back to Overview
        </a>
      </div>
    );
  } else if (mod.path === '/') page = <Overview connections={conns.data} />;
  else if (mod.path === '/finance') page = <Finance month={/^\d{4}-\d{2}$/.test(month) ? month : currentMonth()} />;
  else if (mod.path === '/connections') page = <Connections connections={conns.data} error={conns.error} reload={conns.reload} />;
  else if (mod.path === '/audit') page = <Audit />;
  else page = <ModulePage module={mod} connections={conns.data} />;

  let group: string | null = null;
  return (
    <div class={`shell ${collapsed ? 'collapsed' : ''} ${drawer ? 'drawer-open' : ''}`} onClick={onLinkClick}>
      <a class="skip" href="#main" onClick={(e) => (e.preventDefault(), document.getElementById('main')?.focus())}>
        Skip to content
      </a>
      <nav class="sidebar" aria-label="Dashboard">
        <a class="brand" href="/" aria-label="Benjaire Ops, Overview">
          <Logo />
          <span>Benjaire Ops</span>
        </a>
        {MODULES.map((m) => {
          const header = m.group && m.group !== group ? ((group = m.group), <div class="nav-group label">{m.group}</div>) : null;
          const state = m.path === '/finance' ? 'manual' : moduleState(m, conns.data);
          return (
            <>
              {header}
              <a key={m.path} class="nav-link" href={m.path} aria-current={m.path === url.pathname ? 'page' : undefined} title={collapsed ? m.label : undefined}>
                <span class="ico" aria-hidden="true">
                  {m.icon}
                </span>
                <span class="name">{m.label}</span>
                {state && <span class={`dot ${state}`} aria-label={state.replace('_', ' ')} />}
              </a>
            </>
          );
        })}
        <button class="btn ghost collapse-btn" type="button" onClick={toggleCollapsed} aria-expanded={!collapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? '»' : '« Collapse'}
        </button>
      </nav>

      <div style={{ minWidth: 0 }}>
        <header class="topbar">
          <button class="btn icon menu-btn" type="button" aria-label="Open navigation" aria-expanded={drawer} onClick={() => setDrawer(true)}>
            ☰
          </button>
          <div class="title">
            <strong>{mod?.label ?? 'Not found'}</strong>
          </div>
          {showRange && (
            <label class="hide-sm">
              <span class="sr-only">Date range</span>
              <select
                class="select"
                value={range}
                onChange={(e) => {
                  const next = new URL(location.href);
                  next.searchParams.set('range', e.currentTarget.value);
                  navigate(next.pathname + next.search, true);
                }}
              >
                {RANGES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l} · vs previous
                  </option>
                ))}
              </select>
            </label>
          )}
          <button class="btn" type="button" onClick={() => setPalette(true)} aria-keyshortcuts="Meta+K Control+K">
            Search <span class="kbd hide-sm">⌘K</span>
          </button>
          <div class="segmented hide-sm" role="group" aria-label="Theme">
            {(['light', 'system', 'dark'] as const).map((t) => (
              <button key={t} type="button" aria-pressed={theme === t} onClick={() => setTheme(t)}>
                {t === 'system' ? 'Auto' : t === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
          {me.data && (
            <span class="muted hide-sm" title={`Signed in as ${me.data.email}`} style={{ fontSize: '12px' }}>
              {me.data.email}
            </span>
          )}
        </header>
        <main id="main" tabIndex={-1}>
          {page}
        </main>
      </div>
      {drawer && <div class="scrim" style={{ zIndex: 30 }} onClick={() => setDrawer(false)} aria-hidden="true" />}
      {palette && <Palette onClose={() => setPalette(false)} setTheme={setTheme} />}
    </div>
  );
}
