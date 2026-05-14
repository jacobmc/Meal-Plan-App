import { and, between, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { meals, scheduleEntries } from "@/lib/db/schema";
import type { MealSlot } from "@/lib/db/schema";
import {
  MEAL_SLOTS,
  type ResolvedDay,
  type ResolvedSlot,
  type ResolvedSlotEntry,
  type ResolvedWeek,
} from "./types";
import { formatISODate, weekDates } from "./week";

function emptyDay(): ResolvedDay {
  return {
    breakfast: { kind: "empty" },
    lunch: { kind: "empty" },
    dinner: { kind: "empty" },
    snack: { kind: "empty" },
  };
}

function toEntry(row: typeof scheduleEntries.$inferSelect): ResolvedSlotEntry {
  return {
    id: row.id,
    date: row.date,
    slot: row.slot,
    profileId: row.profileId,
    mealId: row.mealId,
    eatingOut: row.eatingOut,
    eatingOutCost: row.eatingOutCost != null ? Number(row.eatingOutCost) : null,
    eatingOutLabel: row.eatingOutLabel,
    notes: row.notes,
    updatedAt: row.updatedAt.toISOString(),
  };
}

type Row = typeof scheduleEntries.$inferSelect & {
  mealName: string | null;
  mealTags: string[] | null;
};

function rowToResolved(row: Row, source: "default" | "override"): ResolvedSlot {
  if (row.eatingOut) {
    return { kind: "eat-out", entry: toEntry(row), source };
  }
  if (row.mealId && row.mealName != null) {
    return {
      kind: "meal",
      entry: toEntry(row),
      meal: { id: row.mealId, name: row.mealName, tags: row.mealTags ?? [] },
      source,
    };
  }
  return { kind: "empty" };
}

export async function resolveWeek(
  familyId: string,
  weekStart: Date,
  profileId: string | null,
): Promise<ResolvedWeek> {
  const dates = weekDates(weekStart);
  const startISO = formatISODate(dates[0]!);
  const endISO = formatISODate(dates[6]!);

  const rows = (await db
    .select({
      id: scheduleEntries.id,
      familyId: scheduleEntries.familyId,
      date: scheduleEntries.date,
      slot: scheduleEntries.slot,
      profileId: scheduleEntries.profileId,
      mealId: scheduleEntries.mealId,
      eatingOut: scheduleEntries.eatingOut,
      eatingOutCost: scheduleEntries.eatingOutCost,
      eatingOutLabel: scheduleEntries.eatingOutLabel,
      notes: scheduleEntries.notes,
      createdByUserId: scheduleEntries.createdByUserId,
      updatedByUserId: scheduleEntries.updatedByUserId,
      createdAt: scheduleEntries.createdAt,
      updatedAt: scheduleEntries.updatedAt,
      mealName: meals.name,
      mealTags: meals.tags,
    })
    .from(scheduleEntries)
    .leftJoin(meals, eq(scheduleEntries.mealId, meals.id))
    .where(
      and(eq(scheduleEntries.familyId, familyId), between(scheduleEntries.date, startISO, endISO)),
    )) as Row[];

  // Bucket: dateISO → slot → { default?, override? }
  type Bucket = Partial<Record<MealSlot, { def?: Row; overrides: Map<string, Row> }>>;
  const grid: Record<string, Bucket> = {};
  const overrideMap: Record<string, MealSlot[]> = {};

  for (const row of rows) {
    grid[row.date] ??= {};
    grid[row.date]![row.slot] ??= { overrides: new Map() };
    if (row.profileId === null) {
      grid[row.date]![row.slot]!.def = row;
    } else {
      grid[row.date]![row.slot]!.overrides.set(row.profileId, row);
      if (!overrideMap[row.date]?.includes(row.slot)) {
        overrideMap[row.date] = [...(overrideMap[row.date] ?? []), row.slot];
      }
    }
  }

  const days: ResolvedDay[] = dates.map((d) => {
    const iso = formatISODate(d);
    const day = emptyDay();
    for (const slot of MEAL_SLOTS) {
      const bucket = grid[iso]?.[slot];
      if (!bucket) {
        day[slot] = { kind: "empty" };
        continue;
      }
      if (profileId !== null) {
        const ov = bucket.overrides.get(profileId);
        if (ov) {
          day[slot] = rowToResolved(ov, "override");
          continue;
        }
      }
      day[slot] = bucket.def ? rowToResolved(bucket.def, "default") : { kind: "empty" };
    }
    return day;
  });

  return {
    weekStart: formatISODate(weekStart),
    days,
    overrideMap,
  };
}
