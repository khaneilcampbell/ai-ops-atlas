import { useMemo, useState } from 'preact/hooks';
import { MODULES } from '../modules';
import { navigate } from '../router';
import { Dialog } from './ui';

interface Command {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

/** ⌘K search across pages and common actions. */
export function Palette({ onClose, setTheme }: { onClose: () => void; setTheme: (t: 'light' | 'dark' | 'system') => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const commands = useMemo<Command[]>(
    () => [
      ...MODULES.map((m) => ({ id: m.path, label: m.label, hint: 'Page', run: () => navigate(m.path) })),
      { id: 'add-expense', label: 'Add an expense', hint: 'Finance', run: () => navigate('/finance') },
      { id: 'theme-light', label: 'Use light theme', hint: 'Theme', run: () => setTheme('light') },
      { id: 'theme-dark', label: 'Use dark theme', hint: 'Theme', run: () => setTheme('dark') },
      { id: 'theme-system', label: 'Match system theme', hint: 'Theme', run: () => setTheme('system') },
    ],
    [setTheme],
  );
  const results = commands.filter((c) => `${c.label} ${c.hint}`.toLowerCase().includes(q.trim().toLowerCase()));
  const pick = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  return (
    <Dialog label="Search" onClose={onClose} className="palette">
      <input
        class="input"
        type="text"
        enterKeyHint="search"
        placeholder="Search pages and actions"
        aria-label="Search pages and actions"
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
        value={q}
        autoFocus
        onInput={(e) => {
          setQ(e.currentTarget.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            pick(results[active]);
          }
        }}
      />
      <div id="palette-list" role="listbox" aria-label="Results">
        {results.length === 0 && <p class="muted" style={{ padding: '10px 12px' }}>No matches.</p>}
        {results.map((c, i) => (
          <div
            key={c.id}
            id={`cmd-${c.id}`}
            class="opt"
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            onClick={() => pick(c)}
          >
            <span>{c.label}</span>
            <span class="label">{c.hint}</span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
