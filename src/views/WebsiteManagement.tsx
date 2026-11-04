import { Icon } from "../components/Icon";
import { PropertyDashboard } from "../components/PropertyDashboard";
import { PROPERTIES } from "../properties/registry";
import { usePropertyIncidents } from "../properties/state";

/** Mission Control's website management: one live dashboard per site Atlas watches. */
export function WebsiteManagement() {
  const { open } = usePropertyIncidents();
  return (
    <section className="card website-management" id="website-management">
      <div className="card-head">
        <h2 className="grow">Website management</h2>
        <span className={`chip ${open.length ? "chip-bad" : ""}`}>
          <Icon name="alert" size={12} /> {open.length ? `${open.length} open` : "No incidents"}
        </span>
      </div>
      <div className="website-grid">
        {PROPERTIES.map((p) => (
          <PropertyDashboard key={p.id} property={p} />
        ))}
      </div>
    </section>
  );
}
