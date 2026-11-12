# Registered workplace assignments

Implemented on the existing local Marketplace branch. Not merged or deployed. No workers, schedules, integrations or model calls activated.

## Changes

Six existing Commerce workers now have primary desks in Atlas Marketplace, Floor 1, rooms 102–107. Their original project, repository, source, runtime settings and history are unchanged. A comparison with the previous manifest verified that only the six workplace fields changed. They are excluded from Commerce HQ desks to prevent duplicate primary seating.

Existing OpenAI assignments and Atlas production workers on Floor 3 are preserved. Marketplace and OpenAI assigned workers use static seated figures, desk monitors, chairs, nameplates and the existing agent inspector/Output implementation. Selecting a figure/assigned room or its nameplate opens that inspector. Empty Marketplace studios no longer contain pretend workers.

Workplace placement, roster lookup and inspectors use the agent manifest's workplace data. The Marketplace role list supplies labels/draft deliverable metadata only. Schema and parser support eight first-floor Marketplace rooms without broadening other buildings' suite grids.

## Primary workplace inventory

“Project desk” is the existing project office workstation keyed by stable agent ID, not an additional external assignment. Existing execution status is untouched; inspect Output for genuine evidence. New Marketplace-specific workflows are planned and not connected.

| Agent | Owning project | Building | Floor / room | Workspace readiness | Workflow readiness |
|---|---|---|---|---|---|
| Build and Release Engineer (`atlas-ci`) | ai-ops-atlas | Atlas HQ | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Repository Intelligence Analyst (`repo-intelligence`) | ai-ops-atlas | Atlas HQ | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Senior Engineering Reviewer (`atlas-engineering-review`) | ai-ops-atlas | Atlas HQ | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| CI Recovery Specialist (`atlas-rerun-failed`) | ai-ops-atlas | Atlas HQ | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Pull Request Integration Coordinator (`atlas-merge-pr`) | ai-ops-atlas | Atlas HQ | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Repository Maintenance Analyst (`atlas-github-steward`) | ai-ops-atlas | Atlas HQ | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| AI Production Improvement Analyst (`atlas-system-improvements`) | ai-ops-atlas | Atlas HQ | Project office | Moved from Model Lab 401 when Skyline was removed (2026-11-08) | Existing configuration preserved; see recorded Output |
| AI UI Improvement Designer (`atlas-ui-improvement-designer`) | ai-ops-atlas | Atlas HQ | Project office | Moved from Model Lab 402 when Skyline was removed (2026-11-08) | Existing configuration preserved; see recorded Output |
| Atlas Production Coordinator (`atlas-production-coordinator`) | ai-ops-atlas | Atlas HQ | 3 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Atlas Reliability Reviewer (`atlas-reliability-reviewer`) | ai-ops-atlas | Atlas HQ | 3 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Atlas Performance Reviewer (`atlas-performance-reviewer`) | ai-ops-atlas | Atlas HQ | 3 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Inquiry Routing Coordinator (`benjaire-contact-worker`) | benjaire-site | Benjaire HQ | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Client Intake Specialist (`benjaire-flow-intake`) | benjaire-site | Benjaire HQ | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Client Reply Assistant (`benjaire-inquiry-to-client`) | benjaire-site | Benjaire HQ | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Website Quality Engineer (`benjaire-site-ci`) | benjaire-site | Benjaire HQ | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Portfolio Web Developer (`site-builder`) | portfolio-site | Portfolio Site | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Website Quality Auditor (`site-audit`) | portfolio-site | Portfolio Site | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Website Security Analyst (`security-check`) | portfolio-site | Portfolio Site | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Portfolio Quality Engineer (`site-ci`) | portfolio-site | Portfolio Site | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Merge Flow Coordinator (`github-merge-flow`) | github-profile | Profile Tower | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Opportunity Scout (`github-opportunity-scout`) | github-profile | Profile Tower | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Design Consistency (`github-design-consistency`) | github-profile | Profile Tower | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Commerce Operations Coordinator (`commerce-loop`) | commerce-pipeline | Atlas Marketplace | 1 / 102 | Assigned | Building workflow planned |
| Product Opportunity Analyst (`niche-scout`) | commerce-pipeline | Commerce Pipeline | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Market Research Analyst (`market-analyst`) | commerce-pipeline | Atlas Marketplace | 1 / 103 | Assigned | Building workflow planned |
| Brand Strategist (`brand-strategist`) | commerce-pipeline | Atlas Marketplace | 1 / 104 | Assigned | Building workflow planned |
| Visual Identity Director (`visual-director`) | commerce-pipeline | Commerce Pipeline | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Brand Copywriter and SEO Strategist (`copy-strategist`) | commerce-pipeline | Atlas Marketplace | 1 / 105 | Assigned | Building workflow planned |
| Product Launch Planner (`launch-planner`) | commerce-pipeline | Commerce Pipeline | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Product Visualization Designer (`canva-mockups`) | commerce-pipeline | Atlas Marketplace | 1 / 106 | Assigned | Building workflow planned |
| Product Publishing Coordinator (`shopify-publisher`) | commerce-pipeline | Commerce Pipeline | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Search Optimization Specialist (`seo-maintainer`) | commerce-pipeline | Commerce Pipeline | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Pipeline Health Analyst (`health-report`) | commerce-pipeline | Commerce Pipeline | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Digital Fulfillment Coordinator (`order-delivery`) | commerce-pipeline | Commerce Pipeline | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Sales Reporting Specialist (`sales-sync`) | commerce-pipeline | Commerce Pipeline | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Operations Reporting Coordinator (`email-digest`) | commerce-pipeline | Commerce Pipeline | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Database Backup Specialist (`db-backup`) | commerce-pipeline | Commerce Pipeline | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Commerce Quality Engineer (`commerce-tests`) | commerce-pipeline | Atlas Marketplace | 1 / 107 | Assigned | Building workflow planned |
| Technical Documentation Specialist (`docs-builder`) | intelligence-hub | Intelligence Hub | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Documentation Quality Engineer (`hub-ci`) | intelligence-hub | Intelligence Hub | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Application Security Analyst (`service-desk-codeql`) | service-desk | Service Desk | None (building removed 2026-11-09) | Still registered; no desk on the map | Existing configuration preserved; see recorded Output |
| Benjaire Inquiry Assistant (`skyline-inquiry-assistant`) | skyline | Atlas Marketplace | 1 / 101 | Moved from Skyline when the district was removed (2026-11-08) | Existing configuration preserved; see recorded Output |
| Security Case Documentation Specialist (`soc-case-notes`) | soc-lab | SOC Lab | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Threat Detection Analyst (`bruteforce-detection`) | soc-lab | SOC Lab | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |
| Detection Quality Engineer (`soc-lab-ci`) | soc-lab | SOC Lab | 4 / Project desk | Existing project desk retained | Existing configuration preserved; see recorded Output |

## Unassigned and intentionally empty spaces

No registered worker lost its primary workplace. All workers not moved to Marketplace retain their existing project-office or declared workplace assignment. Empty Financial District, BMW, airport, stadium, Atlas Hills, retail and other platform suites were not populated: the registry does not establish a suitable primary role for those spaces, and creating one would invent an assignment or duplicate an existing desk. Residential figures remain the pre-existing visual residence display, not a primary workplace roster.

## Validation and limitations

108 focused tests pass, covering catalog/registry behavior, valid workplace rooms, unique primary assignments, preserved Commerce ownership, Atlas Floor 3, doorway/hallway/landing clearance and existing commute rules. Type checks, lint and production build pass; existing bundle-size and Tauri import warnings remain.

Browser checks cover Marketplace day/night single/all-floor views and recorded Output, plus OpenAI Suite 401 and its Output tab. Screenshots use fixture data rather than production status. No visual baselines changed.

Figures are static. Automatic walking, lift use and workflow execution are not added. Desk placement is not live activity. No $1 cap is newly enforced or claimed. The original building architecture, dimensions, doors, lighting and navigation are retained.
