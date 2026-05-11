import { eq, asc } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { withFamily } from "@/lib/auth/with-family";
import { db } from "@/lib/db/client";
import { users, families, profiles } from "@/lib/db/schema";

export const GET = apiHandler(async () => {
  const { userId, familyId } = await withFamily();

  const [user, family, profileList] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, userId) }),
    db.query.families.findFirst({ where: eq(families.id, familyId) }),
    db
      .select()
      .from(profiles)
      .where(eq(profiles.familyId, familyId))
      .orderBy(asc(profiles.sortOrder), asc(profiles.createdAt)),
  ]);

  return { user, family, profiles: profileList };
});
