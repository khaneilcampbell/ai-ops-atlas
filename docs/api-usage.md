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

The hosted web build has no access to the Mac app's run log, so there it only shows imported files.

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
