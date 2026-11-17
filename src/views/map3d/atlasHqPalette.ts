/**
 * Atlas Command Center's materials (Khaneil, 2026-11-17): cream stone, green glass and restrained
 * brass. The building on the map is the reference; its interior shell reads the same palette so the
 * floors inside look like slices of it. Plain colours only, no three.js.
 */
export const HQ_PALETTE={
 /** Cream stone: floor ledges, fins, ribs, canopy and the lobby plinth. */
 stone:'#e7dcc4',
 /** A shade darker, for roofs and the stone core inside. */
 stoneShade:'#cdbf9f',
 /** Restrained brass: one hairline over the lobby, the door header and canopy. */
 brass:'#b08d52',
 /** Mullions drawn into the glass texture: cream, so the grid reads as stone, not white metal. */
 mullion:'rgba(236,226,204,.9)',
 /** Office floors: forest-green glass, cream spandrels. [top, bottom, spandrel] */
 towerGlass:['#2f5a48','#86ab98','#d9ccb0'],
 /** Night window glow: soft in the offices, warm in the lobby. */
 towerGlow:'#f4ead0',
 wingGlow:'#ffd99a',
} as const;
