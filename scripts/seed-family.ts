#!/usr/bin/env tsx
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { families, users, familyUsers, profiles } from "@/lib/db/schema";

const ConfigSchema = z.object({
  family: z.object({
    name: z.string().min(1),
    timezone: z.string().default("America/New_York"),
    weekStartsOn: z.number().int().min(0).max(6).default(0),
  }),
  users: z
    .array(
      z.object({
        clerkUserId: z.string().min(1),
        email: z.string().email().optional(),
        displayName: z.string().optional(),
      }),
    )
    .min(1),
  profiles: z
    .array(
      z.object({
        displayName: z.string().min(1),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        linkUserClerkId: z.string().optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .min(1),
});

async function main() {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error("Usage: pnpm tsx scripts/seed-family.ts <path-to-config.json>");
    process.exit(1);
  }

  const raw = readFileSync(resolve(configPath), "utf-8");
  const parsed = ConfigSchema.parse(JSON.parse(raw));

  console.log(`Seeding family "${parsed.family.name}"...`);

  const [family] = await db
    .insert(families)
    .values({
      name: parsed.family.name,
      timezone: parsed.family.timezone,
      weekStartsOn: parsed.family.weekStartsOn,
    })
    .returning();

  if (!family) throw new Error("Failed to create family");

  const userIdByClerkId = new Map<string, string>();
  for (const u of parsed.users) {
    const existing = await db.query.users.findFirst({
      where: eq(users.clerkUserId, u.clerkUserId),
    });
    const userRow =
      existing ??
      (
        await db
          .insert(users)
          .values({
            clerkUserId: u.clerkUserId,
            email: u.email,
            displayName: u.displayName,
          })
          .returning()
      )[0];
    if (!userRow) throw new Error(`Failed to upsert user ${u.clerkUserId}`);
    userIdByClerkId.set(u.clerkUserId, userRow.id);

    await db
      .insert(familyUsers)
      .values({ familyId: family.id, userId: userRow.id })
      .onConflictDoNothing();
  }

  for (const [index, p] of parsed.profiles.entries()) {
    const linkedUserId = p.linkUserClerkId ? userIdByClerkId.get(p.linkUserClerkId) : null;
    if (p.linkUserClerkId && !linkedUserId) {
      throw new Error(
        `Profile "${p.displayName}" links to clerkUserId "${p.linkUserClerkId}" which is not in the users array`,
      );
    }
    await db.insert(profiles).values({
      familyId: family.id,
      displayName: p.displayName,
      color: p.color,
      userId: linkedUserId ?? null,
      sortOrder: p.sortOrder ?? index,
    });
  }

  console.log(`✅ Seeded family ${family.id} with ${parsed.users.length} users and ${parsed.profiles.length} profiles.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
