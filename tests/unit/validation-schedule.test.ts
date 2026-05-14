import { describe, it, expect } from "vitest";
import {
  ScheduleEntryCreateSchema,
  ScheduleEntryUpdateSchema,
  CopyWeekSchema,
} from "@/lib/validation/schedule";

describe("ScheduleEntryCreateSchema", () => {
  it("accepts a meal-mode default row", () => {
    const r = ScheduleEntryCreateSchema.safeParse({
      date: "2026-05-11",
      slot: "dinner",
      mealId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(r.success).toBe(true);
  });

  it("accepts an eat-out row with cost and label", () => {
    const r = ScheduleEntryCreateSchema.safeParse({
      date: "2026-05-11",
      slot: "lunch",
      eatingOut: true,
      eatingOutCost: 12.5,
      eatingOutLabel: "Chipotle",
    });
    expect(r.success).toBe(true);
  });

  it("rejects when both mealId and eatingOut are set", () => {
    const r = ScheduleEntryCreateSchema.safeParse({
      date: "2026-05-11",
      slot: "dinner",
      mealId: "550e8400-e29b-41d4-a716-446655440000",
      eatingOut: true,
    });
    expect(r.success).toBe(false);
  });

  it("rejects when neither mealId nor eatingOut is set", () => {
    const r = ScheduleEntryCreateSchema.safeParse({
      date: "2026-05-11",
      slot: "dinner",
    });
    expect(r.success).toBe(false);
  });

  it("rejects eatingOutCost without eatingOut=true", () => {
    const r = ScheduleEntryCreateSchema.safeParse({
      date: "2026-05-11",
      slot: "lunch",
      mealId: "550e8400-e29b-41d4-a716-446655440000",
      eatingOutCost: 9.99,
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid date format", () => {
    const r = ScheduleEntryCreateSchema.safeParse({
      date: "05/11/2026",
      slot: "dinner",
      mealId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid slot", () => {
    const r = ScheduleEntryCreateSchema.safeParse({
      date: "2026-05-11",
      slot: "midnight-snack",
      mealId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(r.success).toBe(false);
  });

  it("accepts optional notes and profileId", () => {
    const r = ScheduleEntryCreateSchema.safeParse({
      date: "2026-05-11",
      slot: "dinner",
      profileId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      mealId: "550e8400-e29b-41d4-a716-446655440000",
      notes: "Sam at sleepover",
    });
    expect(r.success).toBe(true);
  });
});

describe("ScheduleEntryUpdateSchema", () => {
  it("allows notes-only update", () => {
    const r = ScheduleEntryUpdateSchema.safeParse({ notes: "Prep ahead" });
    expect(r.success).toBe(true);
  });

  it("allows toggling from meal to eat-out by setting eatingOut and clearing mealId", () => {
    const r = ScheduleEntryUpdateSchema.safeParse({
      mealId: null,
      eatingOut: true,
      eatingOutCost: 20,
    });
    expect(r.success).toBe(true);
  });

  it("rejects update with both mealId set and eatingOut=true", () => {
    const r = ScheduleEntryUpdateSchema.safeParse({
      mealId: "550e8400-e29b-41d4-a716-446655440000",
      eatingOut: true,
    });
    expect(r.success).toBe(false);
  });
});

describe("CopyWeekSchema", () => {
  it("accepts ISO dates", () => {
    const r = CopyWeekSchema.safeParse({ from: "2026-05-04", to: "2026-05-11" });
    expect(r.success).toBe(true);
  });

  it("rejects bad dates", () => {
    const r = CopyWeekSchema.safeParse({ from: "May 4 2026", to: "2026-05-11" });
    expect(r.success).toBe(false);
  });
});
