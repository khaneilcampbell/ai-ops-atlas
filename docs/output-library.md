# Output Library

Every deliverable agents and workflows produce (reports, text, images, spreadsheets, documents, PDFs)
kept in one place, with where it came from. Open it from the **Library** button in the map toolbar,
or from the **Knowledge & Research Center** building (`service:financial:financial-planning`, module
`knowledge-repository`), which is where the Library lives on the map.

## Where things are stored

| What | Where | Binding |
| --- | --- | --- |
| Metadata (title, format, size, summary, agent, task, workflow run, project, building, checksum, states) | The site's existing D1 database `atlas-live` | `LIVE` (already bound) |
| File bytes | A private R2 bucket, never public | `OUTPUTS` (**not bound yet**, see Setup) |

Nothing is kept in browser storage. Tables are created on first use: `library_outputs` (one row per
logical output) and `library_versions` (one row per immutable version).

**Relationships.** Output → version → agent (`agent`), task (`task_id`, a Task Center id), workflow
and execution (`workflow`, `execution_id`, `run_url`), project, building. A version's `output_key`
defaults to `<agent>:<artifact id>`, so a weekly report keeps one history and each run adds a version.

**Two separate states.**
- Storage: `pending` (recorded, bytes not stored yet) → `saved` (storage accepted the bytes) or
  `failed` (with the reason). "Retrieval verified" is shown only when the stored file was read back
  and its SHA-256 matched (`verified_at`). Metadata existing never means saved.
- Approval: `awaiting`, `approved`, `rejected`, `not_required`. A file can be saved while it awaits approval.

## Adding outputs (producers)

`POST /api/hooks/outputs` with `Authorization: Bearer <AGENT_FEED_TOKEN>` (the existing add-only key;
it can't list or read anything).

```json
{
  "source": { "agent": "benjaire-product-lab", "execution": "<n8n execution id>", "workflow": "product-lab-weekly",
              "task": "task_123", "runUrl": "https://…", "project": "benjaire-site", "via": "n8n" },
  "artifacts": [
    { "id": "brief.md", "title": "Product research brief", "mime": "text/markdown", "text": "…", "requiresApproval": true },
    { "id": "cover.png", "title": "Cover", "mime": "image/png", "base64": "…" }
  ]
}
```

- Up to 10 files per call, 15 MB each, 25 MB per call. Exactly one of `text` or `base64` per file.
- **Idempotent:** the key is SHA-256 of agent + execution + artifact id. Sending the same call again
  answers `duplicate: true` and stores nothing new. A version whose file failed is retried when sent
  again, up to 5 storage attempts in total (3 within one call, with backoff).
- The answer is `202` with one result per file and `missingFiles`, even when storage failed: the
  workflow's own result stands, and the Library shows the missing file prominently.
- In n8n: an HTTP Request node after the node that makes the file, body as above, using
  `{{$execution.id}}` for `execution` and the binary property's base64 for `base64`.

**Automatic capture already wired:** every agent report stored through `/api/hooks/reports`
(Opportunity Scout, Product Lab) is also archived as a JSON report version. Reports still held in D1
(the newest 20 per agent) can be archived with `POST /api/outputs/reconcile` (signed-in page; safe to
repeat). Reports already pruned are not claimed.

## Reading (signed-in page)

All behind Cloudflare Access (`functions/_middleware.ts`), changes same-site only:

- `GET /api/outputs?q=&format=&agent=&project=&approval=&storage=&page=`: latest version per output, 20 per page, no file bytes.
- `GET /api/outputs/<id>`: every version.
- `GET /api/outputs/<id>/versions/<n>/file[?download=1|preview=1]`: the file, streamed from R2. Text
  previews read only the first 256 KB. Text, Markdown, CSV and JSON are served as `text/plain`; HTML,
  SVG and anything else not previewable are served as `application/octet-stream` attachments. Every
  response is `nosniff`, `private, no-store`, and sandboxed by CSP (PDFs excepted, which need the
  browser's viewer and get `default-src 'none'`). `x-atlas-sha256` carries the stored checksum.
- `POST /api/outputs/<id>/versions/<n>/retry`: rebuilds a failed report version from the report D1
  still holds. Other files must be sent again by their workflow (Atlas keeps no copy of a file it couldn't store).

The Mac app doesn't read the Library yet (it would need its own sync-key route in Rust); it says so.

## Setup still needed

1. Enable R2 on the Cloudflare account (R2 has a free tier, but Cloudflare asks for a payment method
   to enable it): https://dash.cloudflare.com/2ff911bc5c9acdcb7f6088b9a25f002f/r2/overview
2. Create a private bucket, e.g. `atlas-outputs` (no public access, no custom domain).
3. Bind it to the Pages project as `OUTPUTS` (Settings → Bindings → R2 bucket):
   https://dash.cloudflare.com/2ff911bc5c9acdcb7f6088b9a25f002f/pages/view/ai-ops-atlas/settings/production
4. Redeploy, then press reconcile (or `POST /api/outputs/reconcile`) to archive the reports D1 still holds.

Until step 3, outputs are recorded with storage `failed` and the reason "File storage isn't connected".

## Local preview

`npm run preview:library`, then open http://localhost:5226 and press **Library**. The dev server runs
the real `server/outputs.ts` on in-memory SQLite and an in-memory bucket, seeded with development
examples (`visual/libraryFixtures.ts`) that the drawer labels as examples. `LIBRARY_PREVIEW_STORAGE=off`
shows the "storage not connected" state.
