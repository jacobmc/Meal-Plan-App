import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { parseISODate, formatISODate } from "./week";

export async function copyWeekPlan(
  familyId: string,
  fromISO: string,
  toISO: string,
  userId: string,
): Promise<{ copied: number }> {
  const from = parseISODate(fromISO);
  const to = parseISODate(toISO);
  const offsetDays = Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
  const fromEnd = new Date(from);
  fromEnd.setUTCDate(fromEnd.getUTCDate() + 6);

  // INSERT ... SELECT, shifted dates, fresh audit, default rows only, skip collisions
  // via ON CONFLICT on the partial unique index for default rows.
  const result = await db.execute(sql`
    INSERT INTO schedule_entries
      (family_id, date, slot, profile_id, meal_id, eating_out, eating_out_cost,
       eating_out_label, notes, created_by_user_id, updated_by_user_id)
    SELECT
      family_id,
      (date + (${offsetDays}::int) * INTERVAL '1 day')::date,
      slot,
      NULL,
      meal_id,
      eating_out,
      eating_out_cost,
      eating_out_label,
      notes,
      ${userId}::uuid,
      ${userId}::uuid
    FROM schedule_entries
    WHERE family_id = ${familyId}::uuid
      AND profile_id IS NULL
      AND date BETWEEN ${fromISO}::date AND ${formatISODate(fromEnd)}::date
    ON CONFLICT (family_id, date, slot) WHERE profile_id IS NULL
      DO NOTHING
  `);

  // Drizzle's execute returns a NeonHttpQueryResult with rowCount on inserts.
  const copied =
    typeof (result as { rowCount?: number }).rowCount === "number"
      ? (result as { rowCount: number }).rowCount
      : 0;
  return { copied };
}
