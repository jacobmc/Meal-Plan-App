import { eq, asc } from "drizzle-orm";
import { withFamily } from "@/lib/auth/with-family";
import { db } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
import { ProfileList } from "@/components/profile-list";

export default async function ProfilesPage() {
  const { familyId } = await withFamily();
  const items = await db
    .select({
      id: profiles.id,
      displayName: profiles.displayName,
      color: profiles.color,
      isActive: profiles.isActive,
    })
    .from(profiles)
    .where(eq(profiles.familyId, familyId))
    .orderBy(asc(profiles.sortOrder), asc(profiles.createdAt));

  return <ProfileList initialItems={items} />;
}
