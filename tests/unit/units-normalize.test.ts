import { describe, it, expect } from "vitest";
import { normalizeUnit } from "@/lib/units/normalize";

describe("normalizeUnit", () => {
  it("returns null for null and empty string", () => {
    expect(normalizeUnit(null)).toBeNull();
    expect(normalizeUnit("")).toBeNull();
    expect(normalizeUnit("   ")).toBeNull();
  });

  it("collapses teaspoon variants to tsp", () => {
    expect(normalizeUnit("teaspoon")).toBe("tsp");
    expect(normalizeUnit("teaspoons")).toBe("tsp");
    expect(normalizeUnit("tsp")).toBe("tsp");
    expect(normalizeUnit("t")).toBe("tsp");
    expect(normalizeUnit("tsp.")).toBe("tsp");
    expect(normalizeUnit("Teaspoon")).toBe("tsp");
    expect(normalizeUnit("  TSP  ")).toBe("tsp");
  });

  it("collapses tablespoon variants to tbsp", () => {
    expect(normalizeUnit("tablespoon")).toBe("tbsp");
    expect(normalizeUnit("tablespoons")).toBe("tbsp");
    expect(normalizeUnit("tbsp")).toBe("tbsp");
    expect(normalizeUnit("T")).toBe("tbsp");
    expect(normalizeUnit("Tbsp.")).toBe("tbsp");
  });

  it("collapses cup variants", () => {
    expect(normalizeUnit("cup")).toBe("cup");
    expect(normalizeUnit("cups")).toBe("cup");
    expect(normalizeUnit("c")).toBe("cup");
  });

  it("collapses weight units", () => {
    expect(normalizeUnit("oz")).toBe("oz");
    expect(normalizeUnit("ounce")).toBe("oz");
    expect(normalizeUnit("ounces")).toBe("oz");
    expect(normalizeUnit("lb")).toBe("lb");
    expect(normalizeUnit("lbs")).toBe("lb");
    expect(normalizeUnit("pound")).toBe("lb");
    expect(normalizeUnit("pounds")).toBe("lb");
    expect(normalizeUnit("g")).toBe("g");
    expect(normalizeUnit("gram")).toBe("g");
    expect(normalizeUnit("grams")).toBe("g");
    expect(normalizeUnit("kg")).toBe("kg");
    expect(normalizeUnit("kilogram")).toBe("kg");
    expect(normalizeUnit("kilograms")).toBe("kg");
  });

  it("collapses volume units", () => {
    expect(normalizeUnit("ml")).toBe("ml");
    expect(normalizeUnit("milliliter")).toBe("ml");
    expect(normalizeUnit("milliliters")).toBe("ml");
    expect(normalizeUnit("l")).toBe("l");
    expect(normalizeUnit("liter")).toBe("l");
    expect(normalizeUnit("liters")).toBe("l");
  });

  it("collapses count-ish units", () => {
    expect(normalizeUnit("each")).toBe("each");
    expect(normalizeUnit("ct")).toBe("each");
    expect(normalizeUnit("count")).toBe("each");
    expect(normalizeUnit("whole")).toBe("each");
    expect(normalizeUnit("can")).toBe("can");
    expect(normalizeUnit("cans")).toBe("can");
    expect(normalizeUnit("package")).toBe("pkg");
    expect(normalizeUnit("packages")).toBe("pkg");
    expect(normalizeUnit("pkg")).toBe("pkg");
    expect(normalizeUnit("pack")).toBe("pkg");
    expect(normalizeUnit("clove")).toBe("clove");
    expect(normalizeUnit("cloves")).toBe("clove");
    expect(normalizeUnit("bunch")).toBe("bunch");
    expect(normalizeUnit("bunches")).toBe("bunch");
    expect(normalizeUnit("slice")).toBe("slice");
    expect(normalizeUnit("slices")).toBe("slice");
    expect(normalizeUnit("sprig")).toBe("sprig");
    expect(normalizeUnit("sprigs")).toBe("sprig");
  });

  it("passes unknown strings through unchanged (trimmed, case-preserved)", () => {
    expect(normalizeUnit("pinch")).toBe("pinch");
    expect(normalizeUnit("Pinch")).toBe("Pinch");
    expect(normalizeUnit("  splash  ")).toBe("splash");
  });
});
