import { and, eq } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { NotFoundError, ValidationError } from "@/lib/auth/errors";
import { withFamily } from "@/lib/auth/with-family";
import { db } from "@/lib/db/client";
import { meals, scheduleEntries } from "@/lib/db/schema";
import { ScheduleEntryUpdateSchema } from "@/lib/validation/schedule";
import { resolveSlotState } from "@/lib/schedule/resolve-slot";
import { serializeEntry } from "@/lib/schedule/serialize";

type Ctx = { params: Promise<{ id: string }> };

async function loadEntry(id: string, familyId: string) {
  const [row] = await db
    .select()
    .from(scheduleEntries)
    .where(and(eq(scheduleEntries.id, id), eq(scheduleEntries.familyId, familyId)));
  if (!row) throw new NotFoundError("Schedule entry not found");
  return row;
}

export const PATCH = apiHandler<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const { familyId, userId } = await withFamily();
  const existing = await loadEntry(id, familyId);

  const json = await req.json();
  const parsed = ScheduleEntryUpdateSchema.safeParse(json);
  if (!parsed.success) {
    throw new ValidationError("Invalid schedule entry payload", parsed.error.flatten());
  }
  const p = parsed.data;

  // Validate FK ownership for changes
  if (p.mealId) {
    const [m] = await db
      .select({ id: meals.id })
      .from(meals)
      .where(and(eq(meals.id, p.mealId), eq(meals.familyId, familyId)));
    if (!m) throw new NotFoundError("Meal not found in this family");
  }

  // Build the patched values. Setting eatingOut=true clears mealId; setting mealId clears eat-out fields.
  const next: Partial<typeof scheduleEntries.$inferInsert> = { updatedByUserId: userId };

  if (p.eatingOut === true) {
    next.eatingOut = true;
    next.mealId = null;
    if (p.eatingOutCost !== undefined)
      next.eatingOutCost = p.eatingOutCost != null ? String(p.eatingOutCost) : null;
    if (p.eatingOutLabel !== undefined) next.eatingOutLabel = p.eatingOutLabel ?? null;
  } else if (p.eatingOut === false || p.mealId !== undefined) {
    if (p.mealId !== undefined) next.mealId = p.mealId;
    if (p.eatingOut === false) next.eatingOut = false;
    if (p.eatingOut === false || (p.mealId !== undefined && p.mealId !== null)) {
      next.eatingOutCost = null;
      next.eatingOutLabel = null;
    }
  }
  if (p.notes !== undefined) next.notes = p.notes ?? null;

  const [updated] = await db
    .update(scheduleEntries)
    .set({ ...next, updatedAt: new Date() })
    .where(eq(scheduleEntries.id, id))
    .returning();

  const resolvedSlot = await resolveSlotState(familyId, existing.date, existing.slot, existing.profileId);
  return { entry: serializeEntry(updated!), resolvedSlot };
});

export const DELETE = apiHandler<Ctx>(async (_req, { params }) => {
  const { id } = await params;
  const { familyId } = await withFamily();
  const existing = await loadEntry(id, familyId);

  await db.delete(scheduleEntries).where(eq(scheduleEntries.id, id));

  // Resolve from the same scope the deleted row was for:
  //  - if it was an override, resolve for that profile (will fall back to default)
  //  - if it was a default, resolve for "no profile" (will return empty since default is gone)
  const resolvedSlot = await resolveSlotState(
    familyId,
    existing.date,
    existing.slot,
    existing.profileId,
  );
  return { resolvedSlot };
});
