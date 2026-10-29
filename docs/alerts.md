# Agent alerts

Some agents run unattended and face customers: the benjaire.com contact Worker and Flow
intake, and the commerce pipeline's loop, order delivery, SEO and mockups. When one of them
fails or stops reporting, Atlas raises an alert so you hear about it quickly, instead of
finding out from a customer.

## What you see

- **Mission Control → Agent alerts** lists every watched agent with its state, the latest
  report and a **Dismiss** button for open alerts. A dismissed alert stays hidden until the
  agent fails again or goes silent again.
- **Header:** a red pill appears while an alert is open (for example "Order Delivery failed").
  Clicking it opens the list. The Mission tab's badge counts open alerts too.
- **Notifications:** tick **Notify me on this device** under the list. The Mac app uses macOS
  notifications (macOS asks once); the website uses browser notifications. On iPhone, Safari
  only allows them when Atlas is added to the Home Screen (iOS 16.4 or later). Only alerts from
  the last 24 hours pop a notification, once each.
- **Email (optional):** the site can email you the moment a pipeline reports a failure, even
  with Atlas closed. See [Email alerts](#email-alerts).

## States

| State | Meaning | Alert |
|---|---|---|
| Failed | The latest completed report was a failure | Yes |
| Silent | No report within the agent's window (`report_within`) | Yes |
| Healthy | The latest completed report succeeded, and it reported in time | No |
| No reports yet | The feed is connected but nothing has arrived on this device | No |
| Unknown | No live source, or this device isn't reading the live feed right now | No |
| Not running | Off on purpose (`not_running`), for example while its host is down | No |

Atlas never shows Healthy without a report. Silence is only judged while this device is
reading the live feed; a failure kept from earlier still shows when the feed is off. A browser
that was closed for a while only gets the last six hours from the site, so a long window can
show "No reports yet" on a fresh device.

## Which agents are watched

An agent is watched when its manifest has an `alerts` block (see
[catalog/README.md](../catalog/README.md)):

```yaml
    observe:
      agent_feed: true
    alerts:
      failures: true        # a failed report raises an alert (default true)
      report_within: 1h     # optional: silent after this long without a report (m, h or d)
      not_running: Why it is off on purpose   # optional: no alerts while set
```

| Agent | Failures | Silence window | Now |
|---|---|---|---|
| benjaire-contact-worker | yes | none (runs per form post) | watched |
| benjaire-flow-intake | yes | none (runs per inquiry) | watched |
| commerce-loop | yes | 8 days (maintain mode sleeps until Monday) | not running |
| order-delivery | yes | 1 hour | not running |
| seo-maintainer | yes | none | not running |
| canva-mockups | yes | none | not running |

The commerce VPS was removed, so the commerce agents are marked `not_running` until the
pipeline moves to the Oracle VM. When it is rehosted, delete the `not_running` lines in
`catalog/multi-agent-commerce-pipeline.yaml`. Check then that the delivery check reports on
every pass even when there are no orders; otherwise widen `report_within` for order-delivery.

The benjaire.com agents only show reports once their Worker and n8n workflow send them to
`/api/hooks/agents` ([live-updates.md](live-updates.md#pipeline-runs-outside-atlas)). Until
then they show "No reports yet".

## Email alerts

When a pipeline posts a `failed` report to `/api/hooks/agents`, the site emails you through
Resend: once when an agent starts failing, a reminder at most every 12 hours while it keeps
failing, and a "recovered" email on its next `ok` report. It covers every agent that reports
to the feed, and it is off until all three settings below exist. A failed email never loses
the report. Silence emails need a scheduled check, which the site doesn't run yet; silence
shows inside Atlas.

Setup, in Cloudflare → Workers & Pages → ai-ops-atlas → Settings → Variables and Secrets
(https://dash.cloudflare.com/2ff911bc5c9acdcb7f6088b9a25f002f/pages/view/ai-ops-atlas/settings/production):

1. `RESEND_API_KEY` (Secret): a new Resend key with **Sending access** only
   (https://resend.com/api-keys).
2. `ALERT_EMAIL_TO` (Text): the address to alert.
3. `ALERT_EMAIL_FROM` (Text): a sender on a domain verified in Resend
   (https://resend.com/domains), for example `Atlas <alerts@benjaire.com>`.
4. Retry the latest production deployment so the function sees them.

Resend's free plan allows 100 emails a day, far more than the reminder rhythm sends.
