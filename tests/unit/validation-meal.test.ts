import { describe, it, expect } from "vitest";
import {
  MealCreateSchema,
  MealUpdateSchema,
  MealIngredientInputSchema,
} from "@/lib/validation/meal";

describe("MealIngredientInputSchema", () => {
  it("accepts a row with only ingredientId", () => {
    const r = MealIngredientInputSchema.safeParse({
      ingredientId: "11111111-1111-1111-8111-111111111111",
      sortOrder: 0,
    });
    expect(r.success).toBe(true);
  });
  it("accepts a row with only displayText", () => {
    const r = MealIngredientInputSchema.safeParse({
      displayText: "a pinch of salt",
      sortOrder: 0,
    });
    expect(r.success).toBe(true);
  });
  it("rejects a row with neither ingredientId nor displayText", () => {
    const r = MealIngredientInputSchema.safeParse({ sortOrder: 0 });
    expect(r.success).toBe(false);
  });
  it("rejects negative quantity", () => {
    const r = MealIngredientInputSchema.safeParse({
      displayText: "x",
      quantity: -1,
      sortOrder: 0,
    });
    expect(r.success).toBe(false);
  });
});

describe("MealCreateSchema", () => {
  const valid = {
    name: "Tacos",
    instructions: "## Steps\n1. ...",
    tags: ["mexican", "quick"],
    ingredients: [{ displayText: "1 lb beef", sortOrder: 0 }],
  };
  it("accepts a minimal valid meal", () => {
    expect(MealCreateSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects empty name", () => {
    expect(MealCreateSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
  });
  it("rejects name longer than 120 chars", () => {
    expect(MealCreateSchema.safeParse({ ...valid, name: "x".repeat(121) }).success).toBe(false);
  });
  it("rejects more than 10 tags", () => {
    expect(
      MealCreateSchema.safeParse({ ...valid, tags: Array(11).fill("t") }).success,
    ).toBe(false);
  });
  it("normalizes tags to lowercase + trimmed + deduped", () => {
    const r = MealCreateSchema.parse({ ...valid, tags: [" Quick ", "QUICK", "Mexican"] });
    expect(r.tags.sort()).toEqual(["mexican", "quick"]);
  });
  it("rejects more than 50 ingredient rows", () => {
    const tooMany = Array(51).fill({ displayText: "x", sortOrder: 0 });
    expect(MealCreateSchema.safeParse({ ...valid, ingredients: tooMany }).success).toBe(false);
  });
});

describe("MealUpdateSchema", () => {
  it("accepts a partial payload", () => {
    expect(MealUpdateSchema.safeParse({ name: "Renamed" }).success).toBe(true);
  });
});
