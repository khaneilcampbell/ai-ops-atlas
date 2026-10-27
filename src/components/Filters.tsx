import { Icon } from "./Icon";
import { useAtlas, type Filters } from "../state";

export interface FilterDef {
  key: Exclude<keyof Filters, "query">;
  label: string;
  options: { value: string; label: string }[];
}

export function FilterBar({ defs, count, noun }: { defs: FilterDef[]; count: number; noun: string }) {
  const { filters, setFilters, clearFilters } = useAtlas();
  const any = filters.query || defs.some((d) => filters[d.key]);
  return (
    <div className="filters" role="search">
      <label className="field">
        <Icon name="search" size={14} />
        <input value={filters.query} onChange={(e) => setFilters({ query: e.target.value })} placeholder={`Search ${noun}`} aria-label={`Search ${noun}`} />
      </label>
      {defs.map((d) => (
        <label key={d.key} className="field">
          <span>{d.label}</span>
          <select value={filters[d.key]} onChange={(e) => setFilters({ [d.key]: e.target.value })}>
            <option value="">All</option>
            {d.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      {any && (
        <button className="text-btn" onClick={clearFilters}>
          Clear filters
        </button>
      )}
      <span className="count">
        {count} {noun}
      </span>
    </div>
  );
}

export function uniqueOptions(values: (string | null | undefined)[]) {
  return [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }));
}
