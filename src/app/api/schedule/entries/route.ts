import { and, eq } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/auth/errors";
import { withFamily } from "@/lib/auth/with-family";
import { db } from "@/lib/db/client";
import {
  meals,
  profiles,
  scheduleEntries,
} from "@/lib/db/schema";
import { ScheduleEntryCreateSchema } from "@/lib/validation/schedule";
import { resolveSlotState } from "@/lib/schedule/resolve-slot";
import { serializeEntry } from "@/lib/schedule/serialize";

export const POST = apiHandler(async (req) => {
  const { familyId, userId } = await withFamily();
  const json = await req.json();
  const parsed = ScheduleEntryCreateSchema.safeParse(json);
  if (!parsed.success) {
    throw new ValidationError("Invalid schedule entry payload", parsed.error.flatten());
  }

  const { date, slot, profileId, mealId, eatingOut, eatingOutCost, eatingOutLabel, notes } = parsed.data;

  // Validate cross-family FKs
  if (profileId) {
    const [p] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(and(eq(profiles.id, profileId), eq(profiles.familyId, familyId)));
    if (!p) throw new NotFoundError("Profile not found in this family");
  }
  if (mealId) {
    const [m] = await db
      .select({ id: meals.id })
      .from(meals)
      .where(and(eq(meals.id, mealId), eq(meals.familyId, familyId)));
    if (!m) throw new NotFoundError("Meal not found in this family");
  }

  try {
    const [inserted] = await db
      .insert(scheduleEntries)
      .values({
        familyId,
        date,
        slot,
        profileId: profileId ?? null,
        mealId: mealId ?? null,
        eatingOut: eatingOut === true,
        eatingOutCost: eatingOutCost != null ? String(eatingOutCost) : null,
        eatingOutLabel: eatingOutLabel ?? null,
        notes: notes ?? null,
        createdByUserId: userId,
        updatedByUserId: userId,
      })
      .returning();

    const resolvedSlot = await resolveSlotState(familyId, date, slot, profileId ?? null);
    return { entry: serializeEntry(inserted!), resolvedSlot };
  } catch (err) {
    const message = (err as { cause?: { message?: string }; message?: string }).cause?.message
      ?? (err as { message?: string }).message
      ?? "";
    if (/schedule_entries_(default|override)_uniq/.test(message)) {
      throw new ConflictError("A schedule entry already exists for this slot");
    }
    throw err;
  }
});
