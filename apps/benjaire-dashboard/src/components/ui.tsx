import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { STATE_LABEL } from '../format';

export function Logo({ size = 22 }: { size?: number }) {
  // Benjaire identity v4 monogram (benjaire.com site/src/components/LogoMark.astro).
  return (
    <svg viewBox="0 0 576 608" height={size} width={Math.round((size * 576) / 608)} aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M0 0 H360 A152 152 0 0 1 512 152 V164 A152 152 0 0 1 485.9 249.17 A152 152 0 0 1 576 388 V456 A152 152 0 0 1 424 608 H80 V280 L160 360 V528 H424 A72 72 0 0 0 496 456 V388 A72 72 0 0 0 424 316 H320 V448 H240 V236 H360 A72 72 0 0 0 432 164 V152 A72 72 0 0 0 360 80 H80 V240 L0 160 Z"
      />
    </svg>
  );
}

export function StatePill({ state, label }: { state: string; label?: string }) {
  return <span class={`pill ${state}`}>{label ?? STATE_LABEL[state] ?? state}</span>;
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div class="notice error" role="alert">
      <span style={{ flex: 1 }}>{message}</span>
      {onRetry && (
        <button class="btn" type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div class="grid" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} class="skeleton" style={{ width: `${90 - i * 15}%` }} />
      ))}
    </div>
  );
}

/** Modal dialog: traps focus, closes on Escape, returns focus on close. */
export function Dialog({ label, onClose, children, className = '' }: { label: string; onClose: () => void; children: ComponentChildren; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const el = ref.current!;
    (el.querySelector<HTMLElement>('[autofocus], input, select, textarea, button') ?? el).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
      if (e.key !== 'Tab') return;
      const items = [...el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex="0"]')];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, [onClose]);
  return (
    <div class="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} class={`dialog ${className}`} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}

/** Horizontally scrollable table container that keyboard users can scroll. */
export function TableWrap({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="table-wrap" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
