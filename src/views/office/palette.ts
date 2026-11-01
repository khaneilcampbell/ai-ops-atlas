/**
 * The office's colors, shared by the office scene and the map's Inside view, so a desk, a chair
 * and an agent look the same on the map as they do inside.
 */
export const OFFICE_COLORS = {
  floor: "#d8d2c3",
  rug: "#2f4535",
  wall: "#ece5d2",
  trim: "#2f4535",
  oak: "#c49a6c",
  steel: "#a8aea6",
  dark: "#232a26",
  chair: "#36403a",
  skin: ["#f0c9a4", "#d9a27a", "#a8714d", "#7a4f33"],
  hair: ["#2b2420", "#5a3a22", "#b88a4a", "#d9d2c4"],
  inactive: "#8e938b",
} as const;
