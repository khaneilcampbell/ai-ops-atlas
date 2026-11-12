# Current building list in Activity

Activity's Project filter uses the same off-map project set as the city (`OFF_MAP_PROJECTS` in
`src/catalog/projects.ts`). Removed buildings stay in the catalog and under All, and their stable
project and agent IDs are unchanged. Agent runs are labelled with the project the agent belongs to.
Repository ownership for shared repositories comes from `projectByRepository` (#374).

[Before desktop](before/desktop.jpg) · [After desktop](after/desktop.jpg) · [Before phone](before/phone.jpg) · [After phone](after/phone.jpg)

Screenshots use fixture data.
