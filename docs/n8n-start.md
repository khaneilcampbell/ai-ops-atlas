# Starting n8n workflows from Atlas

Atlas reads n8n with a read-only API key, so on its own it can only show runs. This adds a separate,
narrow way to **start** a few n8n workflows from the Task Center, without widening that key.

## What can be started

Only the workflows in [`src/n8n/startable.ts`](../src/n8n/startable.ts), each with its own input
schema and daily cap:

| Key | n8n workflow | Input | Cap |
| --- | --- | --- | --- |
| `career-job` | Career · Execution Agent | job link (https) or at least 200 characters of the description, optional company and role | 3 a day |
| `product-idea` | Commerce · Add product idea | name, format (doc or presentation), audience, price $3 to $200, optional notes | 5 a day |

At most 10 starts a day in total. Everything else on n8n stays read-only.

## How a start is protected

```
Task Center form ──► site (Access, or the Mac's sync key after Touch ID)
                       │ allow-list · input schema · emergency stop · daily caps · idempotency key
                       │ signs a 2-minute token with N8N_START_SECRET
                       ▼
                     n8n "Atlas Start" webhook (JWT auth: checks signature and expiry)
                       │ "Verify Atlas Start": issuer, this workflow, fresh, payload hash, input again
                       ▼
                     202 + execution id ──► Task Center follows that execution until it finishes
```

- **The secret** lives only in the Cloudflare Pages secret `N8N_START_SECRET` and in the n8n
  credential "Atlas start (JWT)". It is never in the browser, the Mac app or this repository.
- **Each token** names one workflow (`aud`), one start (`jti` = the task's idempotency key), expires
  after 2 minutes, and carries the SHA-256 of the exact payload. n8n stores request headers in its
  execution log, so a token can be seen there, but it can't start anything else or start again.
- **The site** records each idempotency key before sending, so a start goes out once even if two
  devices ask at the same moment. The emergency stop in Mission Control blocks every start.
- **On the Mac**, Touch ID (or the Mac password) approves each start, like GitHub runs.
- **n8n** checks the input again and answers 422 with a reason if anything is off. The workflows'
  own limits still apply (the career agent's $3 a month cap, the commerce approval email).

Code: `server/n8nStart.ts` (site), `functions/api/n8n/start.ts` (page, behind Access),
`functions/api/hooks/n8n-start.ts` (Mac app, sync key), `src-tauri/src/live.rs`
(`live_n8n_start`, Touch ID), `src/views/tasks/N8nStartForm.tsx` (form and review).

## Setup (Khaneil)

Nothing starts until all of these are done. The n8n changes are saved as drafts; the live versions
are untouched until you publish.

1. **Make the secret on your Mac.** In Terminal run `openssl rand -base64 48` and copy the line it
   prints. Don't paste it anywhere except steps 2 and 3.
2. **Save it on the site.** Open
   [Cloudflare Pages → ai-ops-atlas → Settings → Variables and Secrets](https://dash.cloudflare.com/2ff911bc5c9acdcb7f6088b9a25f002f/pages/view/ai-ops-atlas/settings/production).
   Under Production click **Add**, choose type **Secret**, name `N8N_START_SECRET`, paste the value,
   **Save**. It takes effect with the next deploy (merging the pull request deploys).
3. **Save the same value in n8n.** Open
   [n8n → Credentials](https://khancam15.app.n8n.cloud/home/credentials), **Create credential**,
   search **JWT Auth**. Key Type **Passphrase**, Secret = the same value, Algorithm **HS256**.
   Name it `Atlas start (JWT)` and **Save**.
4. **Pick the credential in each workflow.** Open
   [Career · Execution Agent](https://khancam15.app.n8n.cloud/workflow/Zd379gPsiCcBQfwo), double-click
   **Atlas Start**, choose `Atlas start (JWT)` under Credential for JWT Auth, close, **Save**. Do the
   same in [Commerce · Add product idea](https://khancam15.app.n8n.cloud/workflow/1Dc7L3hYKdbTWL2F).
5. **Publish when you want it live.** Click **Publish** in each workflow. Publishing the career agent
   also switches on its Monday 9am summary and daily 10am nudge emails, since it has been a draft
   until now. Publishing Add product idea keeps its form exactly as it is.
6. **Try it.** In Atlas open **Task Center → New task**, pick the workflow
   "n8n · Commerce · Add product idea", save, open the task and click **Start in n8n**. Fill in the
   form, **Review**, then **Confirm** (Touch ID on the Mac). You should see "Started in n8n
   (execution N)", and the task completes when n8n reports the run finished.

If a start is refused, the message says why: not set up (step 2), n8n doesn't know the webhook
(steps 4 and 5), signature not accepted (steps 2 and 3 hold different values), or a cap.

## Adding another workflow

1. In n8n, copy the five nodes **Atlas Start → Verify Atlas Start → Signed by Atlas? → Tell Atlas
   Started / Tell Atlas Refused** from one of the two workflows. Change the webhook path to
   `atlas-start-<key>`, `KEY` in Verify Atlas Start, and its input checks.
2. Add an entry to `src/n8n/startable.ts` with the same key, the workflow id, its fields and a
   daily cap. Keep it to workflows whose worst case is an email to Khaneil or a draft.
3. Update its catalog entry, then open a pull request.

## Rotating the secret

Make a new value, save it in the Pages secret and the n8n credential, then redeploy the site
(retry the latest deployment in Cloudflare). Starts fail with "signature not accepted" between the
two saves; nothing else is affected.
