import { useEffect, useRef } from "react";
import { INTERIOR_CONTROLS, MAP_CONTROLS, type ControlRow } from "./keys";

/**
 * Every way to move around the map, side by side for a MacBook trackpad and an iMac mouse and
 * keyboard. Opened from the map toolbar or with the ? key.
 */
export function ControlsHelp({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => !ref.current?.parentElement?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  return (
    <div className="map-menu controls-help" ref={ref} role="dialog" aria-label="Map controls">
      <ControlsTable title="On the map" rows={MAP_CONTROLS} />
      <ControlsTable title="Inside a building" rows={INTERIOR_CONTROLS} />
      <p className="note">Click the map once before using the keys. Keys move for as long as you hold them. Settings › Map navigation sets the scroll and speed.</p>
    </div>
  );
}

export function ControlsTable({ title, rows }: { title: string; rows: ControlRow[] }) {
  return (
    <table className="controls-table">
      <caption>{title}</caption>
      <thead>
        <tr>
          <th scope="col" />
          <th scope="col">MacBook trackpad</th>
          <th scope="col">iMac mouse and keyboard</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.action}>
            <th scope="row">{r.action}</th>
            <td>{r.trackpad}</td>
            <td>{r.mouse}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
