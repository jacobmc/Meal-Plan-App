import { describe, it, expect } from "vitest";
import {
  CreateGroceryListSchema,
  CreateGroceryItemSchema,
  UpdateGroceryItemSchema,
  CarryOverSchema,
} from "@/lib/validation/grocery";

describe("CreateGroceryListSchema", () => {
  it("accepts a valid body", () => {
    const parsed = CreateGroceryListSchema.parse({
      name: "Groceries", startDate: "2026-07-06", endDate: "2026-07-12",
    });
    expect(parsed.name).toBe("Groceries");
  });

  it("rejects endDate before startDate", () => {
    expect(() =>
      CreateGroceryListSchema.parse({ name: "x", startDate: "2026-07-12", endDate: "2026-07-06" }),
    ).toThrow();
  });

  it("rejects date-range span > 90 days", () => {
    expect(() =>
      CreateGroceryListSchema.parse({ name: "x", startDate: "2026-01-01", endDate: "2026-06-01" }),
    ).toThrow();
  });

  it("allows omitting name (server assigns default)", () => {
    const parsed = CreateGroceryListSchema.parse({ startDate: "2026-07-06", endDate: "2026-07-12" });
    expect(parsed.name).toBeUndefined();
  });
});

describe("CreateGroceryItemSchema", () => {
  it("requires ingredientId or displayText", () => {
    expect(() => CreateGroceryItemSchema.parse({ category: "produce" })).toThrow();
  });

  it("accepts displayText only", () => {
    const parsed = CreateGroceryItemSchema.parse({ displayText: "salt", category: "other" });
    expect(parsed.displayText).toBe("salt");
  });

  it("accepts ingredientId only", () => {
    const parsed = CreateGroceryItemSchema.parse({
      ingredientId: "11111111-1111-4111-8111-111111111111", category: "produce",
    });
    expect(parsed.ingredientId).toBeDefined();
  });

  it("rejects invalid category", () => {
    expect(() =>
      CreateGroceryItemSchema.parse({ displayText: "x", category: "beverages" as never }),
    ).toThrow();
  });
});

describe("UpdateGroceryItemSchema", () => {
  it("accepts partial updates", () => {
    expect(() => UpdateGroceryItemSchema.parse({ checked: true })).not.toThrow();
    expect(() => UpdateGroceryItemSchema.parse({ quantity: 3 })).not.toThrow();
  });
});

describe("CarryOverSchema", () => {
  it("accepts a well-formed body (same-list identity check lives in the helper)", () => {
    const parsed = CarryOverSchema.parse({ toListId: "22222222-2222-4222-8222-222222222222" });
    expect(parsed.toListId).toBeDefined();
  });

  it("rejects a non-uuid toListId", () => {
    expect(() => CarryOverSchema.parse({ toListId: "same" })).toThrow();
  });
});
