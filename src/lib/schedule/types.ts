import type { MealSlot } from "@/lib/db/schema";

export type { MealSlot };

export const MEAL_SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

export type ResolvedSlotEntry = {
  id: string;
  date: string;            // YYYY-MM-DD
  slot: MealSlot;
  profileId: string | null;
  mealId: string | null;
  eatingOut: boolean;
  eatingOutCost: number | null;
  eatingOutLabel: string | null;
  notes: string | null;
  updatedAt: string;       // ISO timestamp
};

export type ResolvedSlot =
  | { kind: "empty" }
  | {
      kind: "meal";
      entry: ResolvedSlotEntry;
      meal: { id: string; name: string; tags: string[] };
      source: "default" | "override";
    }
  | { kind: "eat-out"; entry: ResolvedSlotEntry; source: "default" | "override" };

export type ResolvedDay = Record<MealSlot, ResolvedSlot>;

export type ResolvedWeek = {
  weekStart: string;                          // YYYY-MM-DD
  days: ResolvedDay[];                        // length 7
  overrideMap: Record<string, MealSlot[]>;    // date → slots that have any override row
};
