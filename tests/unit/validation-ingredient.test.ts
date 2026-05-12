import { describe, it, expect } from "vitest";
import { IngredientCreateSchema } from "@/lib/validation/ingredient";

describe("IngredientCreateSchema", () => {
  const valid = { name: "Onion", category: "produce" as const };
  it("accepts a valid ingredient", () => {
    expect(IngredientCreateSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects bad category", () => {
    expect(
      IngredientCreateSchema.safeParse({ ...valid, category: "bogus" }).success,
    ).toBe(false);
  });
  it("trims and collapses interior whitespace on name", () => {
    const r = IngredientCreateSchema.parse({ ...valid, name: "  Red   Onion  " });
    expect(r.name).toBe("Red Onion");
  });
  it("rejects empty name", () => {
    expect(IngredientCreateSchema.safeParse({ ...valid, name: " " }).success).toBe(false);
  });
});
