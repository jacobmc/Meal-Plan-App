import { scheduleEntries } from "@/lib/db/schema";

export function serializeEntry(row: typeof scheduleEntries.$inferSelect) {
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
