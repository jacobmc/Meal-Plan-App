import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { meals, scheduleEntries } from "@/lib/db/schema";
import type { MealSlot } from "@/lib/db/schema";
import type { ResolvedSlot, ResolvedSlotEntry } from "./types";

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

export async function resolveSlotState(
  familyId: string,
  date: string,
  slot: MealSlot,
  profileId: string | null,
): Promise<ResolvedSlot> {
  // Single query: fetch both possibly-relevant rows in one round-trip.
  const rows = await db
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
      and(
        eq(scheduleEntries.familyId, familyId),
        eq(scheduleEntries.date, date),
        eq(scheduleEntries.slot, slot),
      ),
    );

  const def = rows.find((r) => r.profileId === null);
  const override = profileId ? rows.find((r) => r.profileId === profileId) : undefined;

  const pick = override ?? def;
  if (!pick) return { kind: "empty" };

  const source: "default" | "override" = pick.profileId ? "override" : "default";

  if (pick.eatingOut) {
    return { kind: "eat-out", entry: toEntry(pick), source };
  }
  if (pick.mealId && pick.mealName) {
    return {
      kind: "meal",
      entry: toEntry(pick),
      meal: { id: pick.mealId, name: pick.mealName, tags: pick.mealTags ?? [] },
      source,
    };
  }
  return { kind: "empty" };
}
