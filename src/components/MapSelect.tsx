/**
 * Toolbar dropdown for the map (view and grouping). The face is drawn by us so both menus share
 * one look: the same height, padding, chevron and hover/focus/disabled states as the icon buttons
 * beside them, and as wide as the chosen option (a bare <select> is as wide as its longest option,
 * which left "By tag" floating in empty space). The native <select> sits on top, invisible, so
 * clicks, keyboard and the iPhone picker all behave as before.
 */
export interface MapSelectProps<T extends string> {
  label: string;
  value: T;
  options: readonly T[];
  text: (v: T) => string;
  /** Shorter face text for the phone toolbar; the menu still lists the full names. */
  short?: (v: T) => string;
  onChange: (v: T) => void;
  disabled?: boolean;
  title?: string;
}

export function MapSelect<T extends string>({ label, value, options, text, short, onChange, disabled, title }: MapSelectProps<T>) {
  return (
    <label className={`map-group${disabled ? " disabled" : ""}`} title={title}>
      <span className="map-group-face" aria-hidden="true">
        <span className="map-group-value">{text(value)}</span>
        {short && <span className="map-group-value short">{short(value)}</span>}
        <svg className="map-group-chev" width="10" height="10" viewBox="0 0 10 10"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <select aria-label={label} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {text(o)}
          </option>
        ))}
      </select>
    </label>
  );
}
