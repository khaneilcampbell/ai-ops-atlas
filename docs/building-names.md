# Building names without trademarks

Status: **partly applied (2026-11-07, PR #257).** KC approved the names below, changing two of them
(Robin Exchange, Camton Hotel). Rows marked **Done** are renamed in the app. Rows marked **Open** are
still proposals awaiting KC (American Express, the four Skyline restaurants and shop, the airport
names, vehicles and liveries). Atlas Stadium is handled by the stadium rebuild (PR #263).

Screenshots: `docs/screenshots/building-names/` (before/after, day, night and phone).

## Why

Several map buildings use real company names, logos, signature colours or a real building's name
(Chase, Wells Fargo, American Express, Navy Federal Credit Union, Robinhood, Experian, Vanguard,
The Ritz-Carlton, Circa, BMW, Starbucks, Zara, Chipotle, Smashburger, GitHub, and the AI and SaaS
vendors). Atlas is public on GitHub and is shown as portfolio work, so each one implies an
affiliation that does not exist. The "Unofficial visual representation" captions reduce that risk
but do not remove it. This plan replaces every third-party name on a building with an original one
and removes the matching trade dress (logos, wordmarks, signature colours).

This is a product naming plan, not legal advice. The proposed names below have **not** been
trademark-searched; step 1 of the prompt screens them before anything ships.

## Naming rule

1. **Owned names only.** A building name may contain only:
   - `Atlas` (KC's app and its civic places: HQ, Airport, Marketplace, Hills, stations, stadium),
   - `Benjaire` (KC's company: HQ, Dashboard, Finance, Marketing Agency),
   - KC's own project names from `catalog/*.yaml` (Skyline, SOC Lab, Commerce Pipeline, and so on),
   - an **original fictional business name** from the word bank below, for private businesses in
     the city (banks, hotel, shops, dealership).
   Never a real company, product, person, or real building, and never a lookalike spelling of one.
2. **Shape:** `Name + Role`, Title Case, two or three words, at most 22 characters so it fits the
   168 px nameplate (`PLAQUE` in `src/views/map3d/plaques.tsx`) without clipping. No dots,
   dashes, domains or "The".
3. **Role words** come from one list: HQ, Tower, Bank, Branch, Credit Union, Exchange, Advisors,
   Insights, Hotel, Residences, Mansion, House, Studio, Lab, Office, Desk, Works, Hub, Center,
   Station, Terminal, Hangar, Marketplace, Stadium, Motors, Café, Boutique.
4. **One fictional brand per business**, reused wherever that business appears (the Skyline bank
   branch belongs to the same bank as the Financial District tower).
5. **No trade dress.** Signs use the shared Atlas sign style in the building's own palette. No real
   logo shapes (octagon, feather, roundel, dot cluster, Octocat), wordmark lettering, or a brand's
   signature colour pair.
6. **Real vendors stay as data, not as buildings.** A tool office is named for what the tool does.
   The vendor name ("Uses: Anthropic Messages API") appears only as plain text in the detail panel,
   where it describes a real integration the agents use.

Fictional word bank (invented or generic, to be screened): Bayvale, Halden, Robin, Merrow,
Aldren, Camton, Ravelle, Ellery, Vantor, Ellipse.

## Proposed names

**Done** = renamed in the app. **Open** = proposed, waiting for KC. **Keep** = already owned and
consistent. Ids in `code` are stable and stay as
they are.

### Repo buildings (project HQs, `project.name` in `catalog/*.yaml`)

| Current name | Proposed name | Role | District | Action |
|---|---|---|---|---|
| Atlas HQ | Atlas HQ | Atlas app headquarters (`ai-ops-atlas`) | Atlas | Keep |
| Benjaire HQ | Benjaire HQ | Company website and operations (`benjaire-com`) | Benjaire | Keep |
| Benjaire Dashboard | Benjaire Dashboard | Business dashboard (`benjaire-dashboard`) | Benjaire | Removed from the map 2026-11-09 (lot cleared, streets kept) |
| Commerce Pipeline | Commerce Pipeline | Multi-agent commerce (`multi-agent-commerce-pipeline`) | Commerce | Keep |
| Career Applications | Career Applications | Job application workflow (`job-applications-workflow`) | Career | Removed from the map 2026-11-09 (lot left vacant); repository deleted and catalog file removed 2026-11-10, the lot stays |
| Portfolio Site | Portfolio Site | Personal website (`khaneilcampbell-com`) | Portfolio | Keep |
| GitHub Profile | Profile Tower | GitHub profile README repo (`khaneilcampbell-profile`); GitHub wordmark sign removed | Portfolio | Done |
| Intelligence Hub | Intelligence Hub | Project intelligence (`project-intelligence-hub`) | Intelligence | Keep |
| Service Desk | Service Desk | Service desk dashboard (`service-desk-dashboard`) | Operations | Removed from the map 2026-11-09 (lot left vacant) |
| SOC Lab | SOC Lab | Brute-force detection lab (`splunk-bruteforce-detection-lab`) | Security | Keep |
| Skyline | Skyline | Residences and business district (`skyline`) | Skyline | Keep |

### Financial District (`financialBrands.ts`, `financialPlan.ts`)

| Current name | Proposed name | Role | Stable id | Action |
|---|---|---|---|---|
| Chase | Bayvale Bank | Banking records review | `banks` | Done |
| Wells Fargo | Halden Trust | Bills and records bank tower | `records` | Done |
| American Express | Ellery Budget Center | Life management: spending, budget and bills review; plum Art Deco tower | `budget` | Done |
| Robinhood | Robin Exchange (KC's pick) | Investment records (no trading) | `investments` | Done |
| Navy Federal Credit Union | Merrow Credit Union | Member services and records | `insurance` | Done |
| Experian | Aldren Insights | Credit and data insights offices | `residence` | Done |
| Vanguard | Ravelle Advisors | Financial planning headquarters | `financial-planning` | Done |
| The Ritz-Carlton | Camton Hotel (KC's pick) | Waterfront luxury hotel | `harbor-residence` | Done |
| Circa | Ellipse Residences | Twin-tower residence and pool deck | `circa` | Done |
| Benjaire Finance | Corvane Capital | Business finance house; original drawn logo (ring and rising bars badge), teal and copper | `business-finance` | Done |
| Financial District | Financial District | District nameplate | `FINANCIAL_KEY` | Keep |
| Financial Park | Financial Park | Public park | `FINANCIAL_PARK_KEY` | Keep |
| Financial District Station | Financial Station | Rail stop (26 characters today, clips) | `financial-station` | Open |

### Other districts and landmarks

| Current name | Proposed name | Role | District | Action |
|---|---|---|---|---|
| BMW | Vantor Motors | Car showroom and service; roundel and BMW lettering replaced by a V badge | Financial District edge | Done |
| Atlas Airport | Atlas Airport | Airport district nameplate | Airport | Keep |
| Atlas · Terminal | Atlas Terminal | Check-in and gates | Airport | Open |
| Atlas · Air Traffic | Atlas Control Tower | Airfield safety | Airport | Open |
| Atlas · Maintenance | Atlas Service Hangar | Aircraft maintenance | Airport | Open |
| Atlas · Cargo | Atlas Cargo Hangar | Cargo logistics | Airport | Open |
| Atlas · Operations | Atlas Ops Center | Airport systems | Airport | Open |
| Atlas Marketplace | Atlas Marketplace | Agent mall | Marketplace | Keep |
| Benjaire Marketing Agency | Benjaire Marketing Agency | Marketing agency and Product Lab (24 characters; already shipped, allowed as the one exception) | Bay | Keep |
| Stadium | Atlas Stadium | Venue | Stadium | In PR #263 |
| Atlas Hills | Atlas Hills | District nameplate | Atlas Hills | Keep |
| Atlas Mansion (new, PR #181) | Atlas Mansion | Hills estate | Atlas Hills | Keep |
| Atlas Hills Station | Atlas Hills Station | Rail stop | Atlas Hills | Keep |
| Atlas Station | Atlas Central Station | Main rail stop by the Marketplace | Central | Done |
| Cypress, Palm, Laurel, Vista House; Village Shops; Hills Café; Community Clubhouse; Hills Fitness; Hills Social Club; Health & Wellness Spa; Three-Hole Golf; Golf Clubhouse | Unchanged | Community buildings | Atlas Hills | Keep |

### Skyline storefronts and offices (`tenants` in `scene.ts`, `BUILDING_INTERIORS`)

| Current name | Proposed name | Role | Action |
|---|---|---|---|
| Wells Fargo (branch) | Halden Branch | Bank branch of Halden Trust | Done |
| Starbucks | Corner Coffee | Coffeehouse | Open |
| Smashburger | Skyline Grill | Burger restaurant | Open |
| Chipotle | Fresh Cantina | Fast-casual restaurant | Open |
| Zara | Thread Boutique | Fashion retail | Open |
| Anthropic | Reasoning Lab | AI research office | Done |
| OpenAI | Model Lab | Applied AI office | Done |

### Tool offices (one per external service an agent uses, `toolBrand.ts`)

| Current name | Proposed name | What it does | Action |
|---|---|---|---|
| Anthropic | Reasoning Lab | Claude API calls | Done |
| OpenAI | Model Lab | OpenAI API calls | Done |
| Canva | Design Studio | Design production | Done |
| Stripe | Payments Office | Payments and billing | Done |
| Cloudflare | Edge Office | Hosting, Workers, email | Done |
| Splunk | Log Analytics Lab | Security log search | Done |
| n8n | Automation Works | Workflow automation | Done |
| Serper | Search Desk | Web search API | Done |
| Shopify | Storefront Office | Online store | Done |
| Any other service | `<What it does> Office` | Same rule | Rule |

### Not buildings, but the same risk (fix in the same pass)

| Current | Proposed | Where |
|---|---|---|
| Delta, Emirates, American, Southwest, Qatar liveries | Five fictional liveries: Coastline Air, Sunward Airways, Polaris Air, Bluecrest Airlines, Harborjet | `airlineLiveries.ts` |
| amazon and UPS delivery vans | Atlas Parcel, Atlas Freight | `vehicles.ts`, `living.tsx` |
| MTA bus | Atlas Transit | `living.tsx` |
| BMW cars, G-wagon | Unbadged sedan and SUV models | `vehicles.ts`, `vehicleModels.ts` |

## How it was applied (PR #257)

- Display names changed; stable ids, selection keys and interior routes did not. Each Financial
  District brand keeps its old name in `formerNames` (financialBrands.ts), used only for search and
  old interior routes, never shown.
- Signs: the Chase octagon, Robinhood feather, Experian dot cluster, BMW roundel and lettering, the
  GitHub wordmark, the Splunk `splunk>` mark and the Canva italic are gone. Wells Fargo red and gold,
  Robinhood lime and Experian magenta are replaced on signs and interiors.
- Tool offices: `SERVICES` in `src/catalog/roles.ts` now carries `name` (what it does, shown on the
  map) and `vendor` (the real service, shown as "Uses: ..." in the panel).
- Skyline tenants and agent workplaces: OpenAI, Anthropic and the Wells Fargo branch are now Model Lab,
  Reasoning Lab and Halden Branch in `scene.ts`, `workplaces.ts`, the catalog schema and yaml.
- Guard: `visual/building-names.visual.ts` fails if an old company name shows on a nameplate.

## Senior engineer prompt

For the **Open** rows, paste this into a new engineering session once KC approves them.

```text
You are a senior engineer on Atlas (Tauri Mac app + the same React app on Cloudflare Pages,
repo khaneilcampbell/ai-ops-atlas). Read CLAUDE.md first; every merge to main is a production
release. Never merge; KC merges.

Goal: apply the approved building names in docs/building-names.md so no building, sign, vehicle
or livery uses a real company's name, logo or signature colours. Display names change; stable ids,
selection keys, interior routes and saved state do not.

1. Screen the names first. For every name marked Change or Tidy, search the USPTO trademark
   database (https://tmsearch.uspto.gov) for a live exact or near match in the same field (banks
   and finance class 36, hotels 43, cars 12/35, restaurants 43, retail 35, airlines 39). Swap any
   hit for another word-bank name that passes, and record the result in a "Screening" section of
   docs/building-names.md. Do not change code until this list is final.

2. Inventory before editing. List every place a current name or brand appears:
   rg -n "Chase|Wells Fargo|American Express|Navy Federal|Robinhood|Experian|Vanguard|Ritz|Circa|BMW|Starbucks|Smashburger|Chipotle|Zara|Anthropic|OpenAI|Canva|Stripe|Cloudflare|Splunk|n8n|Serper|Shopify|GitHub|Delta|Emirates|Southwest|Qatar|American Airlines|amazon|UPS|MTA|gwagon" src visual docs catalog
   Sort hits into: display names, sign text and logo drawing, colours, purposes and subtitles,
   interior keys and aliases, tests and visual specs, docs. Leave real integration data alone:
   agent `tools:` lists, API usage, and plain-text "Uses: <vendor>" lines are factual references.

3. Apply in three small pull requests, one branch each, in this order:
   a. Financial District + dealership: financialBrands.ts (name, signLines, subtitle, purpose,
      rooms; drop "Unofficial ... no X connection" wording), FinancialSigns.tsx (remove the
      octagon, feather and experian symbols; use one generic monogram drawn from the new name),
      circaPlan.ts / CircaTowers.tsx / office Circa* labels, Dealership.tsx (no roundel, no BMW
      lettering), the plaque in Map3D.tsx, towerPlan.ts, catalog/buildings.ts, DetailPanel.tsx.
      Keep each old name as a search-only alias (the existing legacyName mechanism) so KC's
      searches still work; never display it.
   b. Skyline storefronts + tool offices + Profile Tower: give each Skyline tenant in scene.ts a
      stable id and build `retail:` and `skylineBuildingKey` keys from that id, not the name, so
      renames never break selection again. Add a display-name map for tool offices
      (service name -> role name) used by plaques, signs and interiors, and show "Uses: <vendor>"
      as plain text in the panel. Replace brand colours in toolBrand.ts with a neutral palette
      keyed by role. Rename github-profile to Profile Tower in its catalog yaml and remove the
      GitHub wordmark from GithubTower.tsx. Tidy airport names in airportBuildings.ts and the
      Stadium plaque.
   c. Vehicles and liveries: airlineLiveries.ts, vehicles.ts, vehicleModels.ts, living.tsx.

4. Guard against regressions. Add src/views/map3d/trademarks.test.ts with a BLOCKED_NAMES list
   (every Change name above) and assert none appears in: plaque names from anchorsOf() across all
   four groupings, FINANCIAL_BRANDS name/signLines, BUILDING_INTERIORS display names, tool office
   display names, airline and vehicle labels. Assert every plaque name is at most 22 characters
   (Benjaire Marketing Agency is the one allowed exception).

5. Update tests and docs that use the old names: financialBrands/financialArchitecture/
   identity/circa/dealership/everyView tests; visual specs that select by name (labels,
   every-view, bmw-park-station, circa, experian, financial-interiors, github-tower, and any
   `.m3-plaque[title^="OpenAI ·"]` selector); docs/financial-tower-identities.md and other docs
   naming the old buildings; README if it shows them.

6. Check every PR: npm run lint, npm run typecheck, npm test, npm run measure:perf (map budget),
   npm run visual with before/after screenshots at desktop and iPhone width, day and night,
   including the Financial District, Skyline storefronts, dealership and airport. Refresh CI visual
   baselines through the visual workflow's update run, not by hand. No Rust changes are expected;
   if src-tauri changes, run the macOS build by hand.

7. Each PR: fill .github/pull_request_template.md, add one CHANGELOG line for KC
   (e.g. "- YYYY-MM-DD · Financial District banks and hotel now use original Atlas names (#PR)"),
   and say in the PR which names changed and that stable ids and saved selections are unchanged.

Done means: no real company name, logo or signature colour on any building, sign, vehicle or
plane; every plaque follows the rule in docs/building-names.md; all checks green; KC has
reviewed screenshots.
```
