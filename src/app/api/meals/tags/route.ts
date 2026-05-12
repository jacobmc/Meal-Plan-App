import { eq, sql } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { withFamily } from "@/lib/auth/with-family";
import { db } from "@/lib/db/client";
import { meals } from "@/lib/db/schema";

export const GET = apiHandler(async () => {
  const { familyId } = await withFamily();
  const rows = await db
    .select({ tag: sql<string>`distinct unnest(${meals.tags})` })
    .from(meals)
    .where(eq(meals.familyId, familyId));
  const items = rows.map((r) => r.tag).sort();
  return { items };
});
