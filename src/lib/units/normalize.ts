// Canonical form → array of aliases (all matched case-insensitively).
const ALIASES: Record<string, string[]> = {
  tsp: ["teaspoon", "teaspoons", "tsp", "t"],
  tbsp: ["tablespoon", "tablespoons", "tbsp", "T"],
  cup: ["cup", "cups", "c"],
  oz: ["ounce", "ounces", "oz"],
  lb: ["pound", "pounds", "lb", "lbs"],
  g: ["gram", "grams", "g"],
  kg: ["kilogram", "kilograms", "kg"],
  ml: ["milliliter", "milliliters", "ml"],
  l: ["liter", "liters", "l"],
  each: ["each", "ct", "count", "whole"],
  can: ["can", "cans"],
  pkg: ["package", "packages", "pkg", "pack"],
  clove: ["clove", "cloves"],
  bunch: ["bunch", "bunches"],
  slice: ["slice", "slices"],
  sprig: ["sprig", "sprigs"],
};

const LOOKUP: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(ALIASES)) {
    for (const a of aliases) {
      // "T" (tablespoon) is matched case-sensitively before this lookup;
      // lowercasing it here would clobber "t" (teaspoon).
      if (a === "T") continue;
      m.set(a.toLowerCase(), canonical);
    }
  }
  return m;
})();

export function normalizeUnit(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim().replace(/\.$/, "");
  if (trimmed === "") return null;

  // Case-sensitive shortcut: single uppercase T is tablespoon, not teaspoon.
  if (trimmed === "T") return "tbsp";

  const canonical = LOOKUP.get(trimmed.toLowerCase());
  return canonical ?? trimmed;
}
