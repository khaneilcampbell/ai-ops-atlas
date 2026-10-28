# API Usage tab

The API Usage tab totals API usage that Atlas can read from a real record. It never calls a
model or a provider to work out its numbers, never polls, and runs nothing in the background:
it reads local records when the tab opens and when you press **Refresh**.

## Where the numbers come from

| Source | How it gets there | Cost shown as |
| --- | --- | --- |
| Repository intelligence runs | Logged by the Mac app on every run that reached Anthropic: the token counts Anthropic reported, the model, the repository, and the attempts. Read with the `intel_runs` command (the run log keeps the latest 300 runs). | **Estimated**: reported tokens × the prices under Settings → Repository intelligence |
| Imported usage files | A JSON file you import on the tab. Stored only in this device's local storage, never sent anywhere. | **Billed** only when a row says `"cost_type": "billed"`, otherwise **estimated** |

Estimated and billed costs are kept apart everywhere: the stat cards, the chart (two series
with a legend), the top-five list and the table each label which is which.

Claude subscription usage (Pro, Max, Claude Code plans) isn't available through API billing
endpoints, so it can't appear here.

## Setup

Nothing shows until a source exists.

1. **Atlas's own agent:** add an Anthropic API key under Settings → Repository intelligence (it
   stays in the macOS Keychain; the web view never sees it). Each analysis run then adds a record.
2. **Other agents (Anthropic or OpenAI):** import a JSON usage file with **Import usage file**.
   Re-importing a file with the same name replaces its earlier rows. **Remove imports** clears them.

The hosted web build can't read the Mac app's run log directly. Turn on **Website sync** (below)
to show the Mac's records there too; otherwise the website shows only files imported in that browser.

## Website sync (Mac → website)

The Mac app can send its recorded usage to the hosted site, so the website and iPhone show the
same numbers. It is off until set up.

```
Mac app ── PUT /api/usage/push (Bearer sync key) ──► Pages Function ──► KV "snapshot"
iPhone ── Cloudflare Access ──► GET /api/usage ──► Pages Function ──► KV "snapshot"
```

- **What is sent:** the usage records only (time, provider, model, agent, repository, token
  counts, estimated cost), in the import format above. No API key or GitHub token is ever sent.
- **When:** after each repository intelligence run finishes while the app is open, when you
  press Refresh on API Usage, and when you press **Send now** in Settings. Never on a timer.
- **The sync key** is 32 random bytes made by the Mac app and kept in the Keychain. The site
  holds the same value as the `USAGE_SYNC_TOKEN` secret. It can only replace the usage snapshot.
- `/api/usage/push` is the one route the Access check skips (the Mac app has no Access
  session); it checks the sync key instead and fails closed without it. `/api/usage`, which the
  page reads, stays behind Access like every other route.

### Setup (once)

1. Mac app → Settings → Website sync: check the address (`https://ai-ops-atlas.pages.dev`), Save,
   then **Make sync key** and **Copy**.
2. Cloudflare → Workers & Pages → ai-ops-atlas → Settings → Variables and secrets → Add →
   type *Secret*, name `USAGE_SYNC_TOKEN`, value: the copied key.
3. Cloudflare → Storage & Databases → KV → Create namespace `atlas-usage`. Then ai-ops-atlas →
   Settings → Bindings → Add → KV namespace, variable name `USAGE`, namespace `atlas-usage`.
4. Zero Trust → Access → Applications → Add → Self-hosted: domain `ai-ops-atlas.pages.dev`,
   path `api/usage/push`, policy action **Bypass**, include **Everyone**. (Only that path;
   the rest of the site keeps its login.)
5. ai-ops-atlas → Deployments → latest production deployment → **Retry deployment**, so the
   secret and binding take effect. Then press **Send now** in the Mac app.

## Import format

A JSON array of records, or an object with a `records` array. Up to 5,000 rows per device.

```json
[
  {
    "at": "2026-10-27T14:00:00Z",
    "provider": "openai",
    "model": "gpt-5",
    "agent": "Commerce Pipeline · Copywriter",
    "project": "khaneilcampbell/multi-agent-commerce-pipeline",
    "requests": 42,
    "input_tokens": 120000,
    "output_tokens": 18000,
    "cache_read_tokens": 40000,
    "cache_write_tokens": 0,
    "cost_usd": 0.91,
    "cost_type": "billed"
  }
]
```

| Field | Required | Notes |
| --- | --- | --- |
| `at` (or `date`) | yes | ISO timestamp or date. Daily totals dated without a time count at local midnight. |
| `provider` | yes | `anthropic`, `openai`, or any other name |
| `model`, `agent`, `project` | no | `project` is best as the GitHub `owner/name`, so it matches the catalog |
| `requests`, `input_tokens`, `output_tokens`, `cache_read_tokens` (or `cached_tokens`), `cache_write_tokens` | no | Non-negative numbers; missing means 0 |
| `cost_usd` | no | Missing means the cost is unknown, not zero |
| `cost_type` | no | `billed` for figures from the provider's billing; anything else is shown as an estimate |

Rows that don't validate are skipped and counted in the import message.
