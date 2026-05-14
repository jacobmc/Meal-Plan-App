import { eq } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { ValidationError } from "@/lib/auth/errors";
import { withFamily } from "@/lib/auth/with-family";
import { db } from "@/lib/db/client";
import { families } from "@/lib/db/schema";
import { resolveWeek } from "@/lib/schedule/resolve";
import { parseISODate, weekStartFor } from "@/lib/schedule/week";

export const GET = apiHandler(async (req) => {
  const { familyId } = await withFamily();
  const url = new URL(req.url);
  const weekParam = url.searchParams.get("week");
  if (!weekParam) {
    throw new ValidationError("Missing required query param: week");
  }
  let parsedDate: Date;
  try {
    parsedDate = parseISODate(weekParam);
  } catch {
    throw new ValidationError("Invalid week format; expected YYYY-MM-DD");
  }

  const [family] = await db.select().from(families).where(eq(families.id, familyId));
  const weekStartsOn = family?.weekStartsOn ?? 0;
  const weekStart = weekStartFor(parsedDate, weekStartsOn);

  const profileParam = url.searchParams.get("profile");
  const profileId = profileParam && profileParam !== "default" ? profileParam : null;

  return await resolveWeek(familyId, weekStart, profileId);
});
