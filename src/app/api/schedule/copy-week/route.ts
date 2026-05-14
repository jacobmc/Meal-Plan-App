import { eq } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { ValidationError } from "@/lib/auth/errors";
import { withFamily } from "@/lib/auth/with-family";
import { db } from "@/lib/db/client";
import { families } from "@/lib/db/schema";
import { copyWeekPlan } from "@/lib/schedule/copy-week";
import { resolveWeek } from "@/lib/schedule/resolve";
import { parseISODate, weekStartFor, formatISODate } from "@/lib/schedule/week";
import { CopyWeekSchema } from "@/lib/validation/schedule";

export const POST = apiHandler(async (req) => {
  const { familyId, userId } = await withFamily();
  const json = await req.json();
  const parsed = CopyWeekSchema.safeParse(json);
  if (!parsed.success) {
    throw new ValidationError("Invalid copy-week payload", parsed.error.flatten());
  }

  const [family] = await db.select().from(families).where(eq(families.id, familyId));
  const weekStartsOn = family?.weekStartsOn ?? 0;
  const fromAligned = weekStartFor(parseISODate(parsed.data.from), weekStartsOn);
  const toAligned = weekStartFor(parseISODate(parsed.data.to), weekStartsOn);

  const result = await copyWeekPlan(
    familyId,
    formatISODate(fromAligned),
    formatISODate(toAligned),
    userId,
  );

  const week = await resolveWeek(familyId, toAligned, null);
  return { copied: result.copied, week };
});
