# Business presets

Each CSV is a complete flow_settings row for a common kind of business: services for Claude to sort by, onboarding documents for the welcome email, reply targets and booking wording.

| Preset | Reply target | Urgent target |
|---|---|---|
| accounting-firm.csv | 24 hours | 4 hours |
| law-firm.csv | 24 hours | 2 hours |
| design-studio.csv | 24 hours | 6 hours |
| it-consultancy.csv | 8 hours | 2 hours |

Create the flow_settings table from the preset you want (or paste its values into your existing row), then replace every example value: names, addresses, website, booking link, n8n_base_url and intake_key. Services and onboarding documents are separated by semicolons; edit them to match exactly what you offer.
