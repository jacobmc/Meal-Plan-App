import { db } from "@/lib/db/client";
import { profiles, familyUsers, users, families } from "@/lib/db/schema";

export async function resetDb() {
  await db.delete(profiles);
  await db.delete(familyUsers);
  await db.delete(users);
  await db.delete(families);
}
