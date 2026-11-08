# Visual office life

The six registered Marketplace production workers occasionally stand, walk through their existing open room doorway, pause in their own hallway section, and return to the same desk. Departures are staggered. Their project ownership, workflows, run status, and recorded Output are unchanged.

Movement uses a bounded deterministic route and elapsed simulation time, with no timers, network requests, model calls, or React state updates per frame. Office life can be switched off in the interior header. It freezes in place for reduced motion, Battery saver, hidden pages, and floors without workers. Resuming continues from the same position.

This first pass covers Marketplace's assigned workspaces. Other building occupants retain their current behavior. Cross-floor travel, elevator journeys, and new task execution are not implemented.

Validation: route samples check floor boundaries and continuous return trips for all six desks. The browser check covers movement controls, reduced-motion pausing, and a rendered screenshot. This visual simulation is not evidence of agent execution.
