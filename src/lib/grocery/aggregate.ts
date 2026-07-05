import { and, between, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ingredients, mealIngredients, scheduleEntries } from "@/lib/db/schema";
import { normalizeUnit } from "@/lib/units/normalize";
import type { DerivedItem, IngredientCategory } from "./types";

type StructuredKey = string; // `s:${ingredientId}:${canonicalUnit ?? ''}`
type UnitlessKey = string; // `u:${ingredientId}`
type MiscKey = string; // `m:${normalizedDisplay}`

function toNumber(n: string | number | null): number | null {
  if (n === null) return null;
  return typeof n === "number" ? n : Number(n);
}

function normalizeMiscText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function generateDerivedItems(
  familyId: string,
  startDate: string,
  endDate: string,
): Promise<DerivedItem[]> {
  // 1. Load in-range schedule instances with a meal_id and not eating out.
  const instances = await db
    .select({ id: scheduleEntries.id, mealId: scheduleEntries.mealId })
    .from(scheduleEntries)
    .where(
      and(
        eq(scheduleEntries.familyId, familyId),
        between(scheduleEntries.date, startDate, endDate),
        isNotNull(scheduleEntries.mealId),
        eq(scheduleEntries.eatingOut, false),
      ),
    );

  if (instances.length === 0) return [];

  // 2. Load meal_ingredients joined to ingredients for the distinct meal_ids.
  const mealIds = Array.from(new Set(instances.map((i) => i.mealId!).filter(Boolean)));
  const rows = await db
    .select({
      mealId: mealIngredients.mealId,
      ingredientId: mealIngredients.ingredientId,
      quantity: mealIngredients.quantity,
      unit: mealIngredients.unit,
      displayText: mealIngredients.displayText,
      ingredientName: ingredients.name,
      ingredientCategory: ingredients.category,
    })
    .from(mealIngredients)
    .leftJoin(ingredients, eq(mealIngredients.ingredientId, ingredients.id))
    .where(inArray(mealIngredients.mealId, mealIds));

  // 3. Bucket per §5 of the design.
  const structured = new Map<StructuredKey, DerivedItem>();
  const unitless = new Map<UnitlessKey, DerivedItem>();
  const misc = new Map<MiscKey, DerivedItem>();

  const byMeal = new Map<string, typeof rows>();
  for (const row of rows) {
    const existing = byMeal.get(row.mealId) ?? [];
    existing.push(row);
    byMeal.set(row.mealId, existing);
  }

  for (const inst of instances) {
    if (!inst.mealId) continue;
    const mealRows = byMeal.get(inst.mealId) ?? [];
    for (const row of mealRows) {
      const qty = toNumber(row.quantity);
      const canonicalUnit = normalizeUnit(row.unit);

      if (row.ingredientId !== null && qty !== null && canonicalUnit !== null) {
        const key: StructuredKey = `s:${row.ingredientId}:${canonicalUnit}`;
        const prev = structured.get(key);
        if (prev) {
          prev.quantity = (prev.quantity ?? 0) + qty;
          prev.sourceScheduleEntryIds.push(inst.id);
        } else {
          structured.set(key, {
            ingredientId: row.ingredientId,
            displayText: null,
            quantity: qty,
            unit: canonicalUnit,
            category: (row.ingredientCategory ?? "other") as IngredientCategory,
            sourceScheduleEntryIds: [inst.id],
          });
        }
        continue;
      }

      if (row.ingredientId !== null) {
        // Unitless or partial: one bucket per ingredient, quantity/unit unset.
        const key: UnitlessKey = `u:${row.ingredientId}`;
        const prev = unitless.get(key);
        if (prev) {
          prev.sourceScheduleEntryIds.push(inst.id);
        } else {
          unitless.set(key, {
            ingredientId: row.ingredientId,
            displayText: null,
            quantity: null,
            unit: null,
            category: (row.ingredientCategory ?? "other") as IngredientCategory,
            sourceScheduleEntryIds: [inst.id],
          });
        }
        continue;
      }

      // Misc: display-text-only.
      if (row.displayText !== null) {
        const norm = normalizeMiscText(row.displayText);
        const key: MiscKey = `m:${norm}`;
        const prev = misc.get(key);
        if (prev) {
          prev.sourceScheduleEntryIds.push(inst.id);
        } else {
          misc.set(key, {
            ingredientId: null,
            displayText: row.displayText,
            quantity: null,
            unit: null,
            category: "other",
            sourceScheduleEntryIds: [inst.id],
          });
        }
      }
    }
  }

  return [...structured.values(), ...unitless.values(), ...misc.values()];
}
