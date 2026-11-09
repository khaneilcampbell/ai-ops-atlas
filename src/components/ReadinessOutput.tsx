import { useState } from 'react';
import { parseReadiness, READINESS_BYTES, type ReadinessPacket } from '../reports/readiness';

export function ReadinessOutput() {
  const [packet, setPacket] = useState<ReadinessPacket | null>(null);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  return <section aria-label="Campaign readiness packet">
    <div className="section-title">Campaign readiness</div>
    <p className="small muted">Inspect a local readiness packet. It stays in this panel’s memory and is cleared when you leave. Importing does not run an agent, upload data, or approve a campaign.</p>
    <label className="small">Open readiness packet <input aria-label="Open readiness packet" type="file" style={{maxWidth:"100%"}} accept=".json,application/json" disabled={reading} onChange={async e => {
      const input = e.currentTarget, file = input.files?.[0]; input.value = '';
      setPacket(null); setError('');
      if (!file) return;
      setReading(true);
      try {
        if (file.size > READINESS_BYTES) throw Error('Packet exceeds 32 KiB.');
        setPacket(parseReadiness(await file.text()));
      } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not read packet.'); }
      finally { setReading(false); }
    }}/></label>
    {reading && <p role="status" className="small">Reading local packet…</p>}
    {error && <p role="alert" className="notice">{error}</p>}
    {packet && <div>
      <p className="notice">{packet.fixture ? 'Synthetic fixture' : 'Supplied input'} · Not independently verified</p>
      <dl className="kv"><dt>Review</dt><dd>Awaiting human approval</dd><dt>Marketplace</dt><dd>Blocked: research, checkout and fulfillment require verification</dd><dt>Recorded by runner</dt><dd>{packet.observed_at}</dd><dt>Revision</dt><dd style={{overflowWrap:'anywhere'}}>{packet.revision}</dd></dl>
      <ol className="small">{packet.events.map(event => <li key={event.event_id}>{event.source_system.replaceAll('_',' ')} · {event.payload.stage_owner}</li>)}</ol>
      <p className="small muted">Stage owners are responsibility assignments, not agent executions. No Atlas telemetry delivered; no publishing or paid calls authorized.</p>
      <button className="ghost-btn" onClick={() => setPacket(null)}>Clear local packet</button>
    </div>}
  </section>;
}
