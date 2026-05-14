# Phase 2 Weekly Calendar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the weekly meal calendar with per-profile overrides, eat-out flag, per-slot notes, copy-last-week, and a responsive layout (agenda on mobile, 7-col grid on desktop). Sequential predecessor to Phase 3 (grocery list), which reads from this schedule.

**Architecture:** One Drizzle table (`schedule_entries`) with a `meal_slot` enum and two partial unique indexes (Postgres treats `NULL`s as distinct in regular unique constraints, so the spec splits "default rows" and "override rows" into separate partial indexes). A pure `resolveWeek(familyId, weekStart, profileId?)` function reads a week's rows in one query, joins meals, and returns a dense 7×4 grid plus an `overrideMap` — same helper feeds the RSC page and the `GET /api/schedule/week` endpoint. Mutations return the resolved slot state so the client can patch in place without refetching. URL search params (`?week=...&profile=...`) drive both navigation and the profile-view toggle.

**Tech Stack:** Next.js 16 (App Router, Turbopack dev / Webpack build), TypeScript, Drizzle ORM + Neon Postgres, Clerk auth, Zod validation, shadcn/ui + Tailwind v4, react-hook-form, date-fns, Vitest, Playwright.

**Source design spec:** [docs/superpowers/specs/2026-05-14-phase-2-weekly-calendar-design.md](../specs/2026-05-14-phase-2-weekly-calendar-design.md). Read this before starting.

**AGENTS.md callout:** `AGENTS.md` reads "This is NOT the Next.js you know" — when in doubt about a Next API (route handler signatures, dynamic route params, RSC vs client conventions), consult `node_modules/next/dist/docs/` before writing the code. Phase 0 and Phase 1 each hit drift bugs because of this.

---

## File map

### Created

```
drizzle/<NNNN>_<auto-name>.sql                 Generated migration
src/lib/validation/schedule.ts                 Zod schemas: ScheduleEntryCreate / Update / CopyWeek
src/lib/schedule/types.ts                      ResolvedSlot, ResolvedDay, ResolvedWeek, MealSlot
src/lib/schedule/week.ts                       weekStartFor(date, weekStartsOn), formatISODate, weekDates(weekStart)
src/lib/schedule/resolve.ts                    resolveWeek() + resolveSlot() helpers
src/lib/schedule/copy-week.ts                  copyWeekPlan(familyId, from, to, userId)

src/app/api/schedule/week/route.ts             GET resolved week
src/app/api/schedule/entries/route.ts          POST create
src/app/api/schedule/entries/[id]/route.ts     PATCH + DELETE
src/app/api/schedule/copy-week/route.ts        POST

src/app/app/calendar/page.tsx                  RSC page (reads searchParams, calls resolveWeek)

src/components/calendar/week-view.tsx          Responsive container — picks agenda vs grid
src/components/calendar/week-grid.tsx          Desktop 7×4 grid
src/components/calendar/day-agenda.tsx         Mobile vertical day cards
src/components/calendar/slot-cell.tsx          Single slot render (meal name / eat-out / override badge / notes glyph)
src/components/calendar/slot-editor.tsx        Client island — modal/bottom-sheet with three modes
src/components/calendar/meal-picker.tsx        Search the meal library and return a mealId
src/components/calendar/eat-out-form.tsx       cost + label inline form
src/components/calendar/notes-input.tsx        Inline single-line notes input
src/components/calendar/profile-toggle.tsx     Header control — updates ?profile
src/components/calendar/week-nav.tsx           Prev / Today / Next — updates ?week
src/components/calendar/copy-week-button.tsx   Confirm dialog + POST

tests/unit/schedule-week.test.ts               weekStartFor + weekDates + formatISODate
tests/unit/schedule-resolve.test.ts            resolveWeek under various row layouts
tests/unit/schedule-copy-week.test.ts          copyWeekPlan date-shift + collision skip (DB-backed)
tests/unit/validation-schedule.test.ts         Zod schemas + xor refinement
tests/integration/api-schedule-entries.test.ts POST / PATCH / DELETE
tests/integration/api-schedule-week.test.ts    GET (default + per-profile)
tests/integration/api-schedule-copy-week.test.ts
```

### Modified

```
src/lib/db/schema.ts                           Add mealSlot enum + scheduleEntries
src/app/app/layout.tsx                         Add "Calendar" nav link, keep "Recipes" and "Profiles"
src/app/app/page.tsx                           Redirect /app → /app/calendar
src/app/app/meals/page.tsx                     Add "Plan a week →" link in the header
tests/helpers/db.ts                            resetDb() drops scheduleEntries before mealIngredients
tests/e2e/smoke.spec.ts                        Add calendar flow (signed-in)
```

---

## Task 1: Schema — `meal_slot` enum + `schedule_entries` table

**Files:**
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: Add `pgEnum` to the imports**

Open `src/lib/db/schema.ts`. The current imports already include `pgTable, uuid, text, timestamp, smallint, boolean, primaryKey, uniqueIndex, index, integer, numeric, check`. Add `pgEnum` and `date`:

```ts
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  smallint,
  boolean,
  primaryKey,
  uniqueIndex,
  index,
  integer,
  numeric,
  date,
  check,
} from "drizzle-orm/pg-core";
```

- [ ] **Step 2: Add the `mealSlot` enum near the top of the file**

Place it directly under the imports (above `families`):

```ts
export const mealSlot = pgEnum("meal_slot", ["breakfast", "lunch", "dinner", "snack"]);
```

- [ ] **Step 3: Add the `scheduleEntries` table at the end of the file (before the final `void sql;`)**

```ts
export const scheduleEntries = pgTable(
  "schedule_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    slot: mealSlot("slot").notNull(),
    profileId: uuid("profile_id").references(() => profiles.id, { onDelete: "cascade" }),
    mealId: uuid("meal_id").references(() => meals.id, { onDelete: "set null" }),
    eatingOut: boolean("eating_out").notNull().default(false),
    eatingOutCost: numeric("eating_out_cost", { precision: 10, scale: 2 }),
    eatingOutLabel: text("eating_out_label"),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    defaultUniq: uniqueIndex("schedule_entries_default_uniq")
      .on(table.familyId, table.date, table.slot)
      .where(sql`${table.profileId} is null`),
    overrideUniq: uniqueIndex("schedule_entries_override_uniq")
      .on(table.familyId, table.date, table.slot, table.profileId)
      .where(sql`${table.profileId} is not null`),
    familyDateIdx: index("schedule_entries_family_date_idx").on(table.familyId, table.date),
    mealXorEatout: check(
      "schedule_entries_meal_xor_eatout",
      sql`not (${table.mealId} is not null and ${table.eatingOut} = true)`,
    ),
    eatoutFieldsCheck: check(
      "schedule_entries_eatout_fields_check",
      sql`${table.eatingOut} = true or (${table.eatingOutCost} is null and ${table.eatingOutLabel} is null)`,
    ),
  }),
);

export type ScheduleEntry = typeof scheduleEntries.$inferSelect;
export type NewScheduleEntry = typeof scheduleEntries.$inferInsert;
export type MealSlot = (typeof mealSlot.enumValues)[number];
```

- [ ] **Step 4: Generate the migration**

```bash
pnpm db:generate
```

Expected: a new `drizzle/<NNNN>_<auto-name>.sql` file containing `CREATE TYPE meal_slot AS ENUM (...)`, `CREATE TABLE schedule_entries`, the two partial unique indexes (`WHERE profile_id IS NULL` / `WHERE profile_id IS NOT NULL`), and the `family_date` index.

- [ ] **Step 5: Open the migration file and verify the partial indexes survived generation**

Open the newly created file. Confirm two `CREATE UNIQUE INDEX` statements include `WHERE "profile_id" IS NULL` and `WHERE "profile_id" IS NOT NULL`. If Drizzle dropped the predicates, edit the SQL by hand — Drizzle has historically had patchy support for partial-index predicates and the spec REQUIRES them.

- [ ] **Step 6: Apply the migration locally**

```bash
pnpm db:migrate
```

Expected: migration applies cleanly against the local `mealplan` DB.

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/schema.ts drizzle/
git commit -m "feat(db): schedule_entries table + meal_slot enum"
```

---

## Task 2: Update `resetDb()` test helper

**Files:**
- Modify: `tests/helpers/db.ts`

- [ ] **Step 1: Add the new import and delete call**

The current file deletes child tables before parents. `scheduleEntries` is a child of `families`, `profiles`, `meals`, and `users` — delete it first.

Replace `tests/helpers/db.ts` with:

```ts
import { db } from "@/lib/db/client";
import {
  scheduleEntries,
  mealIngredients,
  meals,
  ingredients,
  profiles,
  familyUsers,
  users,
  families,
} from "@/lib/db/schema";

export async function resetDb() {
  // Order matters: cascade-aware deletion. Children first, then parents.
  await db.delete(scheduleEntries);
  await db.delete(mealIngredients);
  await db.delete(meals);
  await db.delete(ingredients);
  await db.delete(profiles);
  await db.delete(familyUsers);
  await db.delete(users);
  await db.delete(families);
}
```

- [ ] **Step 2: Run the existing test suite to confirm no regressions**

```bash
pnpm test
```

Expected: all existing 71 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/helpers/db.ts
git commit -m "test(helpers): resetDb covers schedule_entries"
```

---

## Task 3: Pure date helpers — `weekStartFor`, `weekDates`, `formatISODate`

**Files:**
- Create: `src/lib/schedule/week.ts`
- Create: `tests/unit/schedule-week.test.ts`

`families.weekStartsOn` is a `smallint` matching JS `Date.getDay()` (0 = Sunday, 1 = Monday, …, 6 = Saturday). The helper computes the Monday-or-whatever start for a given date and a given week-start day.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/schedule-week.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { weekStartFor, weekDates, formatISODate } from "@/lib/schedule/week";

describe("formatISODate", () => {
  it("formats Date to YYYY-MM-DD in UTC", () => {
    expect(formatISODate(new Date(Date.UTC(2026, 4, 14)))).toBe("2026-05-14");
  });
});

describe("weekStartFor", () => {
  it("returns the same date when given the week-start day", () => {
    // 2026-05-11 is a Monday
    const monday = new Date(Date.UTC(2026, 4, 11));
    expect(formatISODate(weekStartFor(monday, 1))).toBe("2026-05-11");
  });

  it("walks back to Monday when week starts on Monday", () => {
    // 2026-05-14 is a Thursday
    const thursday = new Date(Date.UTC(2026, 4, 14));
    expect(formatISODate(weekStartFor(thursday, 1))).toBe("2026-05-11");
  });

  it("walks back to Sunday when week starts on Sunday", () => {
    // 2026-05-14 is a Thursday
    const thursday = new Date(Date.UTC(2026, 4, 14));
    expect(formatISODate(weekStartFor(thursday, 0))).toBe("2026-05-10");
  });

  it("walks back from Sunday to previous Monday when week starts on Monday", () => {
    // 2026-05-10 is a Sunday
    const sunday = new Date(Date.UTC(2026, 4, 10));
    expect(formatISODate(weekStartFor(sunday, 1))).toBe("2026-05-04");
  });
});

describe("weekDates", () => {
  it("returns 7 dates starting from weekStart", () => {
    const start = new Date(Date.UTC(2026, 4, 11));
    const dates = weekDates(start);
    expect(dates).toHaveLength(7);
    expect(formatISODate(dates[0]!)).toBe("2026-05-11");
    expect(formatISODate(dates[6]!)).toBe("2026-05-17");
  });

  it("handles month boundaries", () => {
    const start = new Date(Date.UTC(2026, 4, 25));
    const dates = weekDates(start);
    expect(formatISODate(dates[6]!)).toBe("2026-05-31");
  });

  it("handles year boundaries", () => {
    const start = new Date(Date.UTC(2026, 11, 28));
    const dates = weekDates(start);
    expect(formatISODate(dates[6]!)).toBe("2027-01-03");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/unit/schedule-week.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

Create `src/lib/schedule/week.ts`:

```ts
export function formatISODate(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`Invalid ISO date: ${s}`);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Compute the start-of-week date for `d`, given the family's week-start day
 * (0 = Sunday, 1 = Monday, ..., 6 = Saturday). Result is normalized to UTC
 * midnight so downstream `DATE` comparisons are stable.
 */
export function weekStartFor(d: Date, weekStartsOn: number): Date {
  const day = d.getUTCDay();
  const diff = (day - weekStartsOn + 7) % 7;
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - diff);
  return start;
}

export function weekDates(weekStart: Date): Date[] {
  const out: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setUTCDate(weekStart.getUTCDate() + i);
    out.push(d);
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm test tests/unit/schedule-week.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/schedule/week.ts tests/unit/schedule-week.test.ts
git commit -m "feat(schedule): date helpers (weekStartFor, weekDates, formatISODate)"
```

---

## Task 4: Resolved types

**Files:**
- Create: `src/lib/schedule/types.ts`

Pure type-only module so both server and client code can import without circular deps.

- [ ] **Step 1: Create the file**

```ts
import type { MealSlot } from "@/lib/db/schema";

export type { MealSlot };

export const MEAL_SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

export type ResolvedSlotEntry = {
  id: string;
  date: string;            // YYYY-MM-DD
  slot: MealSlot;
  profileId: string | null;
  mealId: string | null;
  eatingOut: boolean;
  eatingOutCost: number | null;
  eatingOutLabel: string | null;
  notes: string | null;
  updatedAt: string;       // ISO timestamp
};

export type ResolvedSlot =
  | { kind: "empty" }
  | {
      kind: "meal";
      entry: ResolvedSlotEntry;
      meal: { id: string; name: string; tags: string[] };
      source: "default" | "override";
    }
  | { kind: "eat-out"; entry: ResolvedSlotEntry; source: "default" | "override" };

export type ResolvedDay = Record<MealSlot, ResolvedSlot>;

export type ResolvedWeek = {
  weekStart: string;                          // YYYY-MM-DD
  days: ResolvedDay[];                        // length 7
  overrideMap: Record<string, MealSlot[]>;    // date → slots that have any override row
};
```

- [ ] **Step 2: Confirm types compile**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/schedule/types.ts
git commit -m "feat(schedule): resolved-week types"
```

---

## Task 5: `resolveWeek()` pure function

**Files:**
- Create: `src/lib/schedule/resolve.ts`
- Create: `tests/unit/schedule-resolve.test.ts`

`resolveWeek` runs one DB query, joins meals, then buckets rows in memory. The unit test uses real DB rows (Vitest integration setup is already wired up for Phase 1 tests). The same query path is consumed by both the RSC page and the `/api/schedule/week` route.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/schedule-resolve.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import "@/../tests/setup";
import { db } from "@/lib/db/client";
import { families, users, familyUsers, profiles, meals, scheduleEntries } from "@/lib/db/schema";
import { resolveWeek } from "@/lib/schedule/resolve";
import { resetDb } from "@/../tests/helpers/db";
import { parseISODate } from "@/lib/schedule/week";

async function seedFamilyWithProfile() {
  const [family] = await db.insert(families).values({ name: "Test", weekStartsOn: 1 }).returning();
  const [user] = await db.insert(users).values({ clerkUserId: "clerk_t1", email: "t1@test" }).returning();
  await db.insert(familyUsers).values({ familyId: family!.id, userId: user!.id });
  const [profile] = await db.insert(profiles).values({ familyId: family!.id, displayName: "Sam" }).returning();
  const [meal] = await db.insert(meals).values({ familyId: family!.id, name: "Tacos", tags: ["dinner"] }).returning();
  const [meal2] = await db.insert(meals).values({ familyId: family!.id, name: "Salad", tags: [] }).returning();
  return { family: family!, user: user!, profile: profile!, meal: meal!, meal2: meal2! };
}

describe("resolveWeek", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns all empty slots when there are no entries", async () => {
    const [family] = await db.insert(families).values({ name: "Empty", weekStartsOn: 1 }).returning();
    const week = await resolveWeek(family!.id, parseISODate("2026-05-11"), null);
    expect(week.weekStart).toBe("2026-05-11");
    expect(week.days).toHaveLength(7);
    expect(week.days[0]!.breakfast).toEqual({ kind: "empty" });
    expect(week.days[6]!.dinner).toEqual({ kind: "empty" });
    expect(week.overrideMap).toEqual({});
  });

  it("returns default rows on the family-default view", async () => {
    const { family, user, meal } = await seedFamilyWithProfile();
    await db.insert(scheduleEntries).values({
      familyId: family.id,
      date: "2026-05-11",
      slot: "dinner",
      mealId: meal.id,
      createdByUserId: user.id,
      updatedByUserId: user.id,
    });
    const week = await resolveWeek(family.id, parseISODate("2026-05-11"), null);
    const slot = week.days[0]!.dinner;
    expect(slot.kind).toBe("meal");
    if (slot.kind === "meal") {
      expect(slot.source).toBe("default");
      expect(slot.meal.name).toBe("Tacos");
    }
  });

  it("returns the override when profileId is set and an override exists", async () => {
    const { family, user, profile, meal, meal2 } = await seedFamilyWithProfile();
    await db.insert(scheduleEntries).values([
      {
        familyId: family.id, date: "2026-05-11", slot: "dinner",
        mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
      },
      {
        familyId: family.id, date: "2026-05-11", slot: "dinner",
        profileId: profile.id, mealId: meal2.id, createdByUserId: user.id, updatedByUserId: user.id,
      },
    ]);
    const week = await resolveWeek(family.id, parseISODate("2026-05-11"), profile.id);
    const slot = week.days[0]!.dinner;
    expect(slot.kind).toBe("meal");
    if (slot.kind === "meal") {
      expect(slot.source).toBe("override");
      expect(slot.meal.name).toBe("Salad");
    }
  });

  it("falls back to default when profileId is set but no override exists", async () => {
    const { family, user, profile, meal } = await seedFamilyWithProfile();
    await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-05-11", slot: "dinner",
      mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
    });
    const week = await resolveWeek(family.id, parseISODate("2026-05-11"), profile.id);
    const slot = week.days[0]!.dinner;
    expect(slot.kind).toBe("meal");
    if (slot.kind === "meal") expect(slot.source).toBe("default");
  });

  it("populates overrideMap on the default view", async () => {
    const { family, user, profile, meal, meal2 } = await seedFamilyWithProfile();
    await db.insert(scheduleEntries).values([
      {
        familyId: family.id, date: "2026-05-11", slot: "dinner",
        mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
      },
      {
        familyId: family.id, date: "2026-05-11", slot: "dinner",
        profileId: profile.id, mealId: meal2.id, createdByUserId: user.id, updatedByUserId: user.id,
      },
    ]);
    const week = await resolveWeek(family.id, parseISODate("2026-05-11"), null);
    expect(week.overrideMap["2026-05-11"]).toEqual(["dinner"]);
  });

  it("renders an eating-out entry as kind=eat-out", async () => {
    const { family, user } = await seedFamilyWithProfile();
    await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-05-11", slot: "lunch",
      eatingOut: true, eatingOutCost: "12.50", eatingOutLabel: "Chipotle",
      createdByUserId: user.id, updatedByUserId: user.id,
    });
    const week = await resolveWeek(family.id, parseISODate("2026-05-11"), null);
    const slot = week.days[0]!.lunch;
    expect(slot.kind).toBe("eat-out");
    if (slot.kind === "eat-out") {
      expect(slot.entry.eatingOutCost).toBe(12.5);
      expect(slot.entry.eatingOutLabel).toBe("Chipotle");
    }
  });

  it("renders an orphan entry (meal_id null, eating_out false) as empty", async () => {
    const { family, user } = await seedFamilyWithProfile();
    // Insert directly via raw values to simulate a meal that was later deleted
    await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-05-11", slot: "breakfast",
      mealId: null, eatingOut: false,
      createdByUserId: user.id, updatedByUserId: user.id,
    });
    const week = await resolveWeek(family.id, parseISODate("2026-05-11"), null);
    expect(week.days[0]!.breakfast).toEqual({ kind: "empty" });
  });

  it("filters by family — does not see another family's rows", async () => {
    const { family: famA, user: userA, meal: mealA } = await seedFamilyWithProfile();
    const [famB] = await db.insert(families).values({ name: "Other", weekStartsOn: 1 }).returning();
    await db.insert(scheduleEntries).values({
      familyId: famB!.id, date: "2026-05-11", slot: "dinner",
      mealId: mealA.id, // cross-family, intentionally invalid setup for the test
      createdByUserId: userA.id, updatedByUserId: userA.id,
    });
    const week = await resolveWeek(famA.id, parseISODate("2026-05-11"), null);
    expect(week.days[0]!.dinner).toEqual({ kind: "empty" });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
pnpm test tests/unit/schedule-resolve.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `resolveWeek`**

Create `src/lib/schedule/resolve.ts`:

```ts
import { and, between, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { meals, scheduleEntries } from "@/lib/db/schema";
import type { MealSlot } from "@/lib/db/schema";
import {
  MEAL_SLOTS,
  type ResolvedDay,
  type ResolvedSlot,
  type ResolvedSlotEntry,
  type ResolvedWeek,
} from "./types";
import { formatISODate, weekDates } from "./week";

function emptyDay(): ResolvedDay {
  return {
    breakfast: { kind: "empty" },
    lunch: { kind: "empty" },
    dinner: { kind: "empty" },
    snack: { kind: "empty" },
  };
}

function toEntry(row: typeof scheduleEntries.$inferSelect): ResolvedSlotEntry {
  return {
    id: row.id,
    date: row.date,
    slot: row.slot,
    profileId: row.profileId,
    mealId: row.mealId,
    eatingOut: row.eatingOut,
    eatingOutCost: row.eatingOutCost != null ? Number(row.eatingOutCost) : null,
    eatingOutLabel: row.eatingOutLabel,
    notes: row.notes,
    updatedAt: row.updatedAt.toISOString(),
  };
}

type Row = typeof scheduleEntries.$inferSelect & {
  mealName: string | null;
  mealTags: string[] | null;
};

function rowToResolved(row: Row, source: "default" | "override"): ResolvedSlot {
  if (row.eatingOut) {
    return { kind: "eat-out", entry: toEntry(row), source };
  }
  if (row.mealId && row.mealName != null) {
    return {
      kind: "meal",
      entry: toEntry(row),
      meal: { id: row.mealId, name: row.mealName, tags: row.mealTags ?? [] },
      source,
    };
  }
  return { kind: "empty" };
}

export async function resolveWeek(
  familyId: string,
  weekStart: Date,
  profileId: string | null,
): Promise<ResolvedWeek> {
  const dates = weekDates(weekStart);
  const startISO = formatISODate(dates[0]!);
  const endISO = formatISODate(dates[6]!);

  const rows = (await db
    .select({
      id: scheduleEntries.id,
      familyId: scheduleEntries.familyId,
      date: scheduleEntries.date,
      slot: scheduleEntries.slot,
      profileId: scheduleEntries.profileId,
      mealId: scheduleEntries.mealId,
      eatingOut: scheduleEntries.eatingOut,
      eatingOutCost: scheduleEntries.eatingOutCost,
      eatingOutLabel: scheduleEntries.eatingOutLabel,
      notes: scheduleEntries.notes,
      createdByUserId: scheduleEntries.createdByUserId,
      updatedByUserId: scheduleEntries.updatedByUserId,
      createdAt: scheduleEntries.createdAt,
      updatedAt: scheduleEntries.updatedAt,
      mealName: meals.name,
      mealTags: meals.tags,
    })
    .from(scheduleEntries)
    .leftJoin(meals, eq(scheduleEntries.mealId, meals.id))
    .where(
      and(eq(scheduleEntries.familyId, familyId), between(scheduleEntries.date, startISO, endISO)),
    )) as Row[];

  // Bucket: dateISO → slot → { default?, override? }
  type Bucket = Partial<Record<MealSlot, { def?: Row; overrides: Map<string, Row> }>>;
  const grid: Record<string, Bucket> = {};
  const overrideMap: Record<string, MealSlot[]> = {};

  for (const row of rows) {
    grid[row.date] ??= {};
    grid[row.date]![row.slot] ??= { overrides: new Map() };
    if (row.profileId === null) {
      grid[row.date]![row.slot]!.def = row;
    } else {
      grid[row.date]![row.slot]!.overrides.set(row.profileId, row);
      if (!overrideMap[row.date]?.includes(row.slot)) {
        overrideMap[row.date] = [...(overrideMap[row.date] ?? []), row.slot];
      }
    }
  }

  const days: ResolvedDay[] = dates.map((d) => {
    const iso = formatISODate(d);
    const day = emptyDay();
    for (const slot of MEAL_SLOTS) {
      const bucket = grid[iso]?.[slot];
      if (!bucket) {
        day[slot] = { kind: "empty" };
        continue;
      }
      if (profileId !== null) {
        const ov = bucket.overrides.get(profileId);
        if (ov) {
          day[slot] = rowToResolved(ov, "override");
          continue;
        }
      }
      day[slot] = bucket.def ? rowToResolved(bucket.def, "default") : { kind: "empty" };
    }
    return day;
  });

  return {
    weekStart: formatISODate(weekStart),
    days,
    overrideMap,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm test tests/unit/schedule-resolve.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/schedule/resolve.ts tests/unit/schedule-resolve.test.ts
git commit -m "feat(schedule): resolveWeek + override resolution"
```

---

## Task 6: Zod validation schemas

**Files:**
- Create: `src/lib/validation/schedule.ts`
- Create: `tests/unit/validation-schedule.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/validation-schedule.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  ScheduleEntryCreateSchema,
  ScheduleEntryUpdateSchema,
  CopyWeekSchema,
} from "@/lib/validation/schedule";

describe("ScheduleEntryCreateSchema", () => {
  it("accepts a meal-mode default row", () => {
    const r = ScheduleEntryCreateSchema.safeParse({
      date: "2026-05-11",
      slot: "dinner",
      mealId: "00000000-0000-0000-0000-000000000001",
    });
    expect(r.success).toBe(true);
  });

  it("accepts an eat-out row with cost and label", () => {
    const r = ScheduleEntryCreateSchema.safeParse({
      date: "2026-05-11",
      slot: "lunch",
      eatingOut: true,
      eatingOutCost: 12.5,
      eatingOutLabel: "Chipotle",
    });
    expect(r.success).toBe(true);
  });

  it("rejects when both mealId and eatingOut are set", () => {
    const r = ScheduleEntryCreateSchema.safeParse({
      date: "2026-05-11",
      slot: "dinner",
      mealId: "00000000-0000-0000-0000-000000000001",
      eatingOut: true,
    });
    expect(r.success).toBe(false);
  });

  it("rejects when neither mealId nor eatingOut is set", () => {
    const r = ScheduleEntryCreateSchema.safeParse({
      date: "2026-05-11",
      slot: "dinner",
    });
    expect(r.success).toBe(false);
  });

  it("rejects eatingOutCost without eatingOut=true", () => {
    const r = ScheduleEntryCreateSchema.safeParse({
      date: "2026-05-11",
      slot: "lunch",
      mealId: "00000000-0000-0000-0000-000000000001",
      eatingOutCost: 9.99,
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid date format", () => {
    const r = ScheduleEntryCreateSchema.safeParse({
      date: "05/11/2026",
      slot: "dinner",
      mealId: "00000000-0000-0000-0000-000000000001",
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid slot", () => {
    const r = ScheduleEntryCreateSchema.safeParse({
      date: "2026-05-11",
      slot: "midnight-snack",
      mealId: "00000000-0000-0000-0000-000000000001",
    });
    expect(r.success).toBe(false);
  });

  it("accepts optional notes and profileId", () => {
    const r = ScheduleEntryCreateSchema.safeParse({
      date: "2026-05-11",
      slot: "dinner",
      profileId: "00000000-0000-0000-0000-000000000abc",
      mealId: "00000000-0000-0000-0000-000000000001",
      notes: "Sam at sleepover",
    });
    expect(r.success).toBe(true);
  });
});

describe("ScheduleEntryUpdateSchema", () => {
  it("allows notes-only update", () => {
    const r = ScheduleEntryUpdateSchema.safeParse({ notes: "Prep ahead" });
    expect(r.success).toBe(true);
  });

  it("allows toggling from meal to eat-out by setting eatingOut and clearing mealId", () => {
    const r = ScheduleEntryUpdateSchema.safeParse({
      mealId: null,
      eatingOut: true,
      eatingOutCost: 20,
    });
    expect(r.success).toBe(true);
  });

  it("rejects update with both mealId set and eatingOut=true", () => {
    const r = ScheduleEntryUpdateSchema.safeParse({
      mealId: "00000000-0000-0000-0000-000000000001",
      eatingOut: true,
    });
    expect(r.success).toBe(false);
  });
});

describe("CopyWeekSchema", () => {
  it("accepts ISO dates", () => {
    const r = CopyWeekSchema.safeParse({ from: "2026-05-04", to: "2026-05-11" });
    expect(r.success).toBe(true);
  });

  it("rejects bad dates", () => {
    const r = CopyWeekSchema.safeParse({ from: "May 4 2026", to: "2026-05-11" });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/unit/validation-schedule.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the Zod schemas**

Create `src/lib/validation/schedule.ts`:

```ts
import { z } from "zod";

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const Slot = z.enum(["breakfast", "lunch", "dinner", "snack"]);

const ScheduleEntryBase = z.object({
  date: IsoDate,
  slot: Slot,
  profileId: z.string().uuid().nullable().optional(),
  mealId: z.string().uuid().nullable().optional(),
  eatingOut: z.boolean().optional(),
  eatingOutCost: z.number().min(0).max(9999.99).nullable().optional(),
  eatingOutLabel: z.string().min(1).max(80).nullable().optional(),
  notes: z.string().min(1).max(500).nullable().optional(),
});

function refineMealXorEatout<T extends z.ZodTypeAny>(s: T): T {
  return s.superRefine((val, ctx) => {
    const mealSet = val.mealId != null;
    const eatOut = val.eatingOut === true;
    if (mealSet && eatOut) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Cannot set both mealId and eatingOut=true",
        path: ["eatingOut"],
      });
    }
    if (!eatOut && (val.eatingOutCost != null || val.eatingOutLabel != null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "eatingOutCost and eatingOutLabel require eatingOut=true",
        path: ["eatingOutCost"],
      });
    }
  }) as unknown as T;
}

export const ScheduleEntryCreateSchema = refineMealXorEatout(
  ScheduleEntryBase.superRefine((val, ctx) => {
    const mealSet = val.mealId != null;
    const eatOut = val.eatingOut === true;
    if (!mealSet && !eatOut) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Either mealId or eatingOut=true is required",
        path: ["mealId"],
      });
    }
  }),
);

export const ScheduleEntryUpdateSchema = refineMealXorEatout(ScheduleEntryBase.partial());

export const CopyWeekSchema = z.object({
  from: IsoDate,
  to: IsoDate,
});

export type ScheduleEntryCreate = z.infer<typeof ScheduleEntryCreateSchema>;
export type ScheduleEntryUpdate = z.infer<typeof ScheduleEntryUpdateSchema>;
export type CopyWeekInput = z.infer<typeof CopyWeekSchema>;
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm test tests/unit/validation-schedule.test.ts
```

Expected: 12 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation/schedule.ts tests/unit/validation-schedule.test.ts
git commit -m "feat(schedule): Zod validation schemas"
```

---

## Task 7: `copyWeekPlan()` helper

**Files:**
- Create: `src/lib/schedule/copy-week.ts`
- Create: `tests/unit/schedule-copy-week.test.ts`

Copies default rows (where `profile_id IS NULL`) from a source week into a target week, refreshing audit columns and skipping target-week collisions.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/schedule-copy-week.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import "@/../tests/setup";
import { db } from "@/lib/db/client";
import { and, eq } from "drizzle-orm";
import { families, users, familyUsers, profiles, meals, scheduleEntries } from "@/lib/db/schema";
import { copyWeekPlan } from "@/lib/schedule/copy-week";
import { resetDb } from "@/../tests/helpers/db";

async function seed() {
  const [family] = await db.insert(families).values({ name: "Test", weekStartsOn: 1 }).returning();
  const [user] = await db.insert(users).values({ clerkUserId: "clerk_cw", email: "cw@test" }).returning();
  await db.insert(familyUsers).values({ familyId: family!.id, userId: user!.id });
  const [profile] = await db.insert(profiles).values({ familyId: family!.id, displayName: "Sam" }).returning();
  const [meal] = await db.insert(meals).values({ familyId: family!.id, name: "Tacos", tags: [] }).returning();
  return { family: family!, user: user!, profile: profile!, meal: meal! };
}

describe("copyWeekPlan", () => {
  beforeEach(async () => { await resetDb(); });

  it("copies default rows by shifting the date forward 7 days", async () => {
    const { family, user, meal } = await seed();
    await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-05-04", slot: "dinner",
      mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
    });
    const result = await copyWeekPlan(family.id, "2026-05-04", "2026-05-11", user.id);
    expect(result.copied).toBe(1);
    const rows = await db
      .select()
      .from(scheduleEntries)
      .where(and(eq(scheduleEntries.familyId, family.id), eq(scheduleEntries.date, "2026-05-11")));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.mealId).toBe(meal.id);
  });

  it("does not copy override rows", async () => {
    const { family, user, profile, meal } = await seed();
    await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-05-04", slot: "dinner",
      profileId: profile.id, mealId: meal.id,
      createdByUserId: user.id, updatedByUserId: user.id,
    });
    const result = await copyWeekPlan(family.id, "2026-05-04", "2026-05-11", user.id);
    expect(result.copied).toBe(0);
  });

  it("skips collisions in the target week without overwriting", async () => {
    const { family, user, meal } = await seed();
    await db.insert(scheduleEntries).values([
      { familyId: family.id, date: "2026-05-04", slot: "dinner",
        mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id },
      // Pre-existing default in the target week
      { familyId: family.id, date: "2026-05-11", slot: "dinner",
        mealId: meal.id, notes: "preserve me",
        createdByUserId: user.id, updatedByUserId: user.id },
    ]);
    const result = await copyWeekPlan(family.id, "2026-05-04", "2026-05-11", user.id);
    expect(result.copied).toBe(0);
    const [target] = await db
      .select()
      .from(scheduleEntries)
      .where(and(eq(scheduleEntries.familyId, family.id), eq(scheduleEntries.date, "2026-05-11")));
    expect(target!.notes).toBe("preserve me");
  });

  it("only copies rows from the source week, not surrounding days", async () => {
    const { family, user, meal } = await seed();
    await db.insert(scheduleEntries).values([
      { familyId: family.id, date: "2026-05-03", slot: "dinner",  // day before source week
        mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id },
      { familyId: family.id, date: "2026-05-04", slot: "dinner",  // in source week
        mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id },
      { familyId: family.id, date: "2026-05-10", slot: "dinner",  // end of source week
        mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id },
      { familyId: family.id, date: "2026-05-11", slot: "dinner",  // already in target
        mealId: null, eatingOut: true, eatingOutCost: "5.00",
        createdByUserId: user.id, updatedByUserId: user.id },
    ]);
    const result = await copyWeekPlan(family.id, "2026-05-04", "2026-05-11", user.id);
    // 2 source rows (05-04 + 05-10), but 05-04 collides with the existing 05-11 row → 1 copied
    expect(result.copied).toBe(1);
  });

  it("scopes by family — does not copy other families' rows", async () => {
    const { family, user, meal } = await seed();
    const [other] = await db.insert(families).values({ name: "Other", weekStartsOn: 1 }).returning();
    await db.insert(scheduleEntries).values({
      familyId: other!.id, date: "2026-05-04", slot: "dinner",
      mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
    });
    const result = await copyWeekPlan(family.id, "2026-05-04", "2026-05-11", user.id);
    expect(result.copied).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/unit/schedule-copy-week.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `copyWeekPlan`**

Create `src/lib/schedule/copy-week.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm test tests/unit/schedule-copy-week.test.ts
```

Expected: 5 tests pass.

If the test reporting "1 copied" fails because `rowCount` is unavailable on the Neon driver, fall back to a `SELECT count(*)` before the INSERT (rare; only patch if needed).

- [ ] **Step 5: Commit**

```bash
git add src/lib/schedule/copy-week.ts tests/unit/schedule-copy-week.test.ts
git commit -m "feat(schedule): copyWeekPlan helper"
```

---

## Task 8: `GET /api/schedule/week` route

**Files:**
- Create: `src/app/api/schedule/week/route.ts`
- Create: `tests/integration/api-schedule-week.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/api-schedule-week.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import "@/../tests/helpers/auth";
import "@/../tests/setup";
import { db } from "@/lib/db/client";
import { families, users, familyUsers, profiles, meals, scheduleEntries } from "@/lib/db/schema";
import { setMockClerkUser } from "@/../tests/helpers/auth";
import { resetDb } from "@/../tests/helpers/db";
import { GET } from "@/app/api/schedule/week/route";

async function seed() {
  const [family] = await db.insert(families).values({ name: "T", weekStartsOn: 1 }).returning();
  const [user] = await db.insert(users).values({ clerkUserId: "clerk_w", email: "w@test" }).returning();
  await db.insert(familyUsers).values({ familyId: family!.id, userId: user!.id });
  const [profile] = await db.insert(profiles).values({ familyId: family!.id, displayName: "Sam" }).returning();
  const [meal] = await db.insert(meals).values({ familyId: family!.id, name: "Tacos", tags: [] }).returning();
  setMockClerkUser("clerk_w");
  return { family: family!, user: user!, profile: profile!, meal: meal! };
}

function req(url: string) { return new Request(url); }

describe("GET /api/schedule/week", () => {
  beforeEach(async () => { await resetDb(); setMockClerkUser(null); });

  it("returns 401 when unauthenticated", async () => {
    const res = await GET(req("http://test/api/schedule/week?week=2026-05-11"));
    expect(res.status).toBe(401);
  });

  it("returns a week aligned to the family's weekStartsOn", async () => {
    await seed();
    // Family week starts Monday. Pass Thursday — should align to Monday 2026-05-11
    const res = await GET(req("http://test/api/schedule/week?week=2026-05-14"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.weekStart).toBe("2026-05-11");
    expect(body.days).toHaveLength(7);
  });

  it("returns default-view resolution when profile is omitted", async () => {
    const { family, user, meal } = await seed();
    await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-05-11", slot: "dinner",
      mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
    });
    const res = await GET(req("http://test/api/schedule/week?week=2026-05-11"));
    const body = await res.json();
    expect(body.days[0].dinner.kind).toBe("meal");
    expect(body.days[0].dinner.source).toBe("default");
  });

  it("returns per-profile resolution when profile=<id> is supplied", async () => {
    const { family, user, profile, meal } = await seed();
    const [meal2] = await db
      .insert(meals)
      .values({ familyId: family.id, name: "Salad", tags: [] })
      .returning();
    await db.insert(scheduleEntries).values([
      { familyId: family.id, date: "2026-05-11", slot: "dinner",
        mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id },
      { familyId: family.id, date: "2026-05-11", slot: "dinner",
        profileId: profile.id, mealId: meal2!.id,
        createdByUserId: user.id, updatedByUserId: user.id },
    ]);
    const res = await GET(req(`http://test/api/schedule/week?week=2026-05-11&profile=${profile.id}`));
    const body = await res.json();
    expect(body.days[0].dinner.source).toBe("override");
    expect(body.days[0].dinner.meal.name).toBe("Salad");
  });

  it("returns 400 when week is missing", async () => {
    await seed();
    const res = await GET(req("http://test/api/schedule/week"));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/integration/api-schedule-week.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

Create `src/app/api/schedule/week/route.ts`:

```ts
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
  let any: Date;
  try {
    any = parseISODate(weekParam);
  } catch {
    throw new ValidationError("Invalid week format; expected YYYY-MM-DD");
  }

  const [family] = await db.select().from(families).where(eq(families.id, familyId));
  const weekStartsOn = family?.weekStartsOn ?? 0;
  const weekStart = weekStartFor(any, weekStartsOn);

  const profileParam = url.searchParams.get("profile");
  const profileId = profileParam && profileParam !== "default" ? profileParam : null;

  return await resolveWeek(familyId, weekStart, profileId);
});
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm test tests/integration/api-schedule-week.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/schedule/week/route.ts tests/integration/api-schedule-week.test.ts
git commit -m "feat(api): GET /api/schedule/week"
```

---

## Task 9: `POST /api/schedule/entries` route

**Files:**
- Create: `src/app/api/schedule/entries/route.ts`
- Create: `tests/integration/api-schedule-entries.test.ts` (POST tests; PATCH/DELETE follow in Task 10)

- [ ] **Step 1: Write the failing POST tests**

Create `tests/integration/api-schedule-entries.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import "@/../tests/helpers/auth";
import "@/../tests/setup";
import { db } from "@/lib/db/client";
import { and, eq } from "drizzle-orm";
import { families, users, familyUsers, profiles, meals, scheduleEntries } from "@/lib/db/schema";
import { setMockClerkUser } from "@/../tests/helpers/auth";
import { resetDb } from "@/../tests/helpers/db";
import { POST } from "@/app/api/schedule/entries/route";

async function seed() {
  const [family] = await db.insert(families).values({ name: "T", weekStartsOn: 1 }).returning();
  const [user] = await db.insert(users).values({ clerkUserId: "clerk_e", email: "e@test" }).returning();
  await db.insert(familyUsers).values({ familyId: family!.id, userId: user!.id });
  const [profile] = await db.insert(profiles).values({ familyId: family!.id, displayName: "Sam" }).returning();
  const [meal] = await db.insert(meals).values({ familyId: family!.id, name: "Tacos", tags: [] }).returning();
  setMockClerkUser("clerk_e");
  return { family: family!, user: user!, profile: profile!, meal: meal! };
}

function post(body: unknown) {
  return new Request("http://test/api/schedule/entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/schedule/entries", () => {
  beforeEach(async () => { await resetDb(); setMockClerkUser(null); });

  it("401 when unauthenticated", async () => {
    const res = await POST(post({ date: "2026-05-11", slot: "dinner", mealId: "00000000-0000-0000-0000-000000000001" }));
    expect(res.status).toBe(401);
  });

  it("creates a default meal row", async () => {
    const { meal } = await seed();
    const res = await POST(post({ date: "2026-05-11", slot: "dinner", mealId: meal.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entry.profileId).toBeNull();
    expect(body.entry.mealId).toBe(meal.id);
    expect(body.resolvedSlot.kind).toBe("meal");
    expect(body.resolvedSlot.source).toBe("default");
  });

  it("creates an override row", async () => {
    const { profile, meal } = await seed();
    const res = await POST(post({
      date: "2026-05-11", slot: "dinner", profileId: profile.id, mealId: meal.id,
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entry.profileId).toBe(profile.id);
    expect(body.resolvedSlot.source).toBe("override");
  });

  it("creates an eat-out row with cost + label", async () => {
    await seed();
    const res = await POST(post({
      date: "2026-05-11", slot: "lunch", eatingOut: true, eatingOutCost: 12.5, eatingOutLabel: "Chipotle",
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entry.eatingOut).toBe(true);
    expect(body.entry.eatingOutCost).toBe(12.5);
    expect(body.resolvedSlot.kind).toBe("eat-out");
  });

  it("409 on conflict (default row already exists)", async () => {
    const { family, user, meal } = await seed();
    await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-05-11", slot: "dinner",
      mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
    });
    const res = await POST(post({ date: "2026-05-11", slot: "dinner", mealId: meal.id }));
    expect(res.status).toBe(409);
  });

  it("404 when mealId belongs to another family", async () => {
    await seed();
    const [other] = await db.insert(families).values({ name: "Other", weekStartsOn: 1 }).returning();
    const [otherMeal] = await db.insert(meals).values({ familyId: other!.id, name: "X", tags: [] }).returning();
    const res = await POST(post({ date: "2026-05-11", slot: "dinner", mealId: otherMeal!.id }));
    expect(res.status).toBe(404);
  });

  it("404 when profileId belongs to another family", async () => {
    const { meal } = await seed();
    const [other] = await db.insert(families).values({ name: "Other", weekStartsOn: 1 }).returning();
    const [otherProfile] = await db.insert(profiles).values({ familyId: other!.id, displayName: "X" }).returning();
    const res = await POST(post({
      date: "2026-05-11", slot: "dinner", profileId: otherProfile!.id, mealId: meal.id,
    }));
    expect(res.status).toBe(404);
  });

  it("400 when both mealId and eatingOut are set", async () => {
    const { meal } = await seed();
    const res = await POST(post({
      date: "2026-05-11", slot: "dinner", mealId: meal.id, eatingOut: true,
    }));
    expect(res.status).toBe(400);
  });

  it("400 when neither mealId nor eatingOut is set", async () => {
    await seed();
    const res = await POST(post({ date: "2026-05-11", slot: "dinner" }));
    expect(res.status).toBe(400);
  });

  it("persists notes", async () => {
    const { meal } = await seed();
    const res = await POST(post({
      date: "2026-05-11", slot: "dinner", mealId: meal.id, notes: "Prep ahead",
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entry.notes).toBe("Prep ahead");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm test tests/integration/api-schedule-entries.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

Create `src/app/api/schedule/entries/route.ts`:

```ts
import { and, eq, inArray } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/auth/errors";
import { withFamily } from "@/lib/auth/with-family";
import { db } from "@/lib/db/client";
import {
  families,
  meals,
  profiles,
  scheduleEntries,
} from "@/lib/db/schema";
import { ScheduleEntryCreateSchema } from "@/lib/validation/schedule";
import { resolveSlotState } from "@/lib/schedule/resolve-slot";

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

export function serializeEntry(row: typeof scheduleEntries.$inferSelect) {
  return {
    id: row.id,
    date: row.date,
    slot: row.slot,
    profileId: row.profileId,
    mealId: row.mealId,
    eatingOut: row.eatingOut,
    eatingOutCost: row.eatingOutCost != null ? Number(row.eatingOutCost) : null,
    eatingOutLabel: row.eatingOutLabel,
    notes: row.notes,
    updatedAt: row.updatedAt.toISOString(),
  };
}
```

- [ ] **Step 4: Create the per-slot resolver helper**

Create `src/lib/schedule/resolve-slot.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { meals, scheduleEntries } from "@/lib/db/schema";
import type { MealSlot } from "@/lib/db/schema";
import type { ResolvedSlot, ResolvedSlotEntry } from "./types";

function toEntry(row: typeof scheduleEntries.$inferSelect): ResolvedSlotEntry {
  return {
    id: row.id,
    date: row.date,
    slot: row.slot,
    profileId: row.profileId,
    mealId: row.mealId,
    eatingOut: row.eatingOut,
    eatingOutCost: row.eatingOutCost != null ? Number(row.eatingOutCost) : null,
    eatingOutLabel: row.eatingOutLabel,
    notes: row.notes,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function resolveSlotState(
  familyId: string,
  date: string,
  slot: MealSlot,
  profileId: string | null,
): Promise<ResolvedSlot> {
  // Single query: fetch both possibly-relevant rows in one round-trip.
  const rows = await db
    .select({
      id: scheduleEntries.id,
      familyId: scheduleEntries.familyId,
      date: scheduleEntries.date,
      slot: scheduleEntries.slot,
      profileId: scheduleEntries.profileId,
      mealId: scheduleEntries.mealId,
      eatingOut: scheduleEntries.eatingOut,
      eatingOutCost: scheduleEntries.eatingOutCost,
      eatingOutLabel: scheduleEntries.eatingOutLabel,
      notes: scheduleEntries.notes,
      createdByUserId: scheduleEntries.createdByUserId,
      updatedByUserId: scheduleEntries.updatedByUserId,
      createdAt: scheduleEntries.createdAt,
      updatedAt: scheduleEntries.updatedAt,
      mealName: meals.name,
      mealTags: meals.tags,
    })
    .from(scheduleEntries)
    .leftJoin(meals, eq(scheduleEntries.mealId, meals.id))
    .where(
      and(
        eq(scheduleEntries.familyId, familyId),
        eq(scheduleEntries.date, date),
        eq(scheduleEntries.slot, slot),
      ),
    );

  const def = rows.find((r) => r.profileId === null);
  const override = profileId ? rows.find((r) => r.profileId === profileId) : undefined;

  const pick = override ?? def;
  if (!pick) return { kind: "empty" };

  const source: "default" | "override" = pick.profileId ? "override" : "default";

  if (pick.eatingOut) {
    return { kind: "eat-out", entry: toEntry(pick), source };
  }
  if (pick.mealId && pick.mealName) {
    return {
      kind: "meal",
      entry: toEntry(pick),
      meal: { id: pick.mealId, name: pick.mealName, tags: pick.mealTags ?? [] },
      source,
    };
  }
  return { kind: "empty" };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm test tests/integration/api-schedule-entries.test.ts
```

Expected: 10 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/schedule/entries/route.ts src/lib/schedule/resolve-slot.ts tests/integration/api-schedule-entries.test.ts
git commit -m "feat(api): POST /api/schedule/entries + resolveSlotState helper"
```

---

## Task 10: `PATCH` and `DELETE /api/schedule/entries/[id]`

**Files:**
- Create: `src/app/api/schedule/entries/[id]/route.ts`
- Modify: `tests/integration/api-schedule-entries.test.ts` (append PATCH + DELETE describe blocks)

- [ ] **Step 1: Append the failing PATCH/DELETE tests**

Open `tests/integration/api-schedule-entries.test.ts` and add these `describe` blocks below the POST tests. Add the imports at the top: `PATCH` and `DELETE` from the `[id]` route.

```ts
import { PATCH, DELETE } from "@/app/api/schedule/entries/[id]/route";

function patch(body: unknown) {
  return new Request("http://test/api/schedule/entries/_id_", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function del() {
  return new Request("http://test/api/schedule/entries/_id_", { method: "DELETE" });
}

async function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/schedule/entries/[id]", () => {
  beforeEach(async () => { await resetDb(); setMockClerkUser(null); });

  it("swaps meal → eat-out atomically", async () => {
    const { family, user, meal } = await seed();
    const [entry] = await db
      .insert(scheduleEntries)
      .values({
        familyId: family.id, date: "2026-05-11", slot: "lunch",
        mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
      })
      .returning();
    const res = await PATCH(patch({ mealId: null, eatingOut: true, eatingOutCost: 8 }), await ctx(entry!.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entry.mealId).toBeNull();
    expect(body.entry.eatingOut).toBe(true);
    expect(body.entry.eatingOutCost).toBe(8);
  });

  it("swaps eat-out → meal atomically clears cost+label", async () => {
    const { family, user, meal } = await seed();
    const [entry] = await db
      .insert(scheduleEntries)
      .values({
        familyId: family.id, date: "2026-05-11", slot: "lunch",
        eatingOut: true, eatingOutCost: "5.00", eatingOutLabel: "x",
        createdByUserId: user.id, updatedByUserId: user.id,
      })
      .returning();
    const res = await PATCH(patch({ mealId: meal.id, eatingOut: false }), await ctx(entry!.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entry.mealId).toBe(meal.id);
    expect(body.entry.eatingOut).toBe(false);
    expect(body.entry.eatingOutCost).toBeNull();
    expect(body.entry.eatingOutLabel).toBeNull();
  });

  it("notes-only update", async () => {
    const { family, user, meal } = await seed();
    const [entry] = await db
      .insert(scheduleEntries)
      .values({
        familyId: family.id, date: "2026-05-11", slot: "dinner",
        mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
      })
      .returning();
    const res = await PATCH(patch({ notes: "Prep ahead" }), await ctx(entry!.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entry.notes).toBe("Prep ahead");
    expect(body.entry.mealId).toBe(meal.id);
  });

  it("404 on cross-family entry", async () => {
    const { user, meal } = await seed();
    const [other] = await db.insert(families).values({ name: "Other", weekStartsOn: 1 }).returning();
    const [entry] = await db
      .insert(scheduleEntries)
      .values({
        familyId: other!.id, date: "2026-05-11", slot: "dinner",
        mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
      })
      .returning();
    const res = await PATCH(patch({ notes: "x" }), await ctx(entry!.id));
    expect(res.status).toBe(404);
  });

  it("400 when payload sets both mealId and eatingOut=true", async () => {
    const { family, user, meal } = await seed();
    const [entry] = await db
      .insert(scheduleEntries)
      .values({
        familyId: family.id, date: "2026-05-11", slot: "dinner",
        mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
      })
      .returning();
    const res = await PATCH(patch({ mealId: meal.id, eatingOut: true }), await ctx(entry!.id));
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/schedule/entries/[id]", () => {
  beforeEach(async () => { await resetDb(); setMockClerkUser(null); });

  it("deleting an override returns the default's resolved state", async () => {
    const { family, user, profile, meal } = await seed();
    const [meal2] = await db.insert(meals).values({ familyId: family.id, name: "Salad", tags: [] }).returning();
    await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-05-11", slot: "dinner",
      mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
    });
    const [override] = await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-05-11", slot: "dinner",
      profileId: profile.id, mealId: meal2!.id,
      createdByUserId: user.id, updatedByUserId: user.id,
    }).returning();
    const res = await DELETE(del(), await ctx(override!.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    // After deleting the override, the resolved slot for that profile is the default
    expect(body.resolvedSlot.kind).toBe("meal");
    expect(body.resolvedSlot.source).toBe("default");
    expect(body.resolvedSlot.meal.name).toBe("Tacos");
  });

  it("deleting a default returns empty (overrides remain)", async () => {
    const { family, user, profile, meal } = await seed();
    const [meal2] = await db.insert(meals).values({ familyId: family.id, name: "Salad", tags: [] }).returning();
    const [def] = await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-05-11", slot: "dinner",
      mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
    }).returning();
    await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-05-11", slot: "dinner",
      profileId: profile.id, mealId: meal2!.id,
      createdByUserId: user.id, updatedByUserId: user.id,
    });
    const res = await DELETE(del(), await ctx(def!.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resolvedSlot).toEqual({ kind: "empty" });
    // Override is still there
    const remaining = await db
      .select()
      .from(scheduleEntries)
      .where(and(eq(scheduleEntries.familyId, family.id), eq(scheduleEntries.date, "2026-05-11")));
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.profileId).toBe(profile.id);
  });

  it("404 on cross-family entry", async () => {
    const { user, meal } = await seed();
    const [other] = await db.insert(families).values({ name: "Other", weekStartsOn: 1 }).returning();
    const [entry] = await db.insert(scheduleEntries).values({
      familyId: other!.id, date: "2026-05-11", slot: "dinner",
      mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
    }).returning();
    const res = await DELETE(del(), await ctx(entry!.id));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Implement the route**

Create `src/app/api/schedule/entries/[id]/route.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { NotFoundError, ValidationError } from "@/lib/auth/errors";
import { withFamily } from "@/lib/auth/with-family";
import { db } from "@/lib/db/client";
import { meals, profiles, scheduleEntries } from "@/lib/db/schema";
import { ScheduleEntryUpdateSchema } from "@/lib/validation/schedule";
import { resolveSlotState } from "@/lib/schedule/resolve-slot";
import { serializeEntry } from "../route";

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

export const DELETE = apiHandler<Ctx>(async (req, { params }) => {
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
```

- [ ] **Step 3: Run the tests**

```bash
pnpm test tests/integration/api-schedule-entries.test.ts
```

Expected: all (POST + PATCH + DELETE) tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/schedule/entries/\[id\]/route.ts tests/integration/api-schedule-entries.test.ts
git commit -m "feat(api): PATCH + DELETE /api/schedule/entries/[id]"
```

---

## Task 11: `POST /api/schedule/copy-week` route

**Files:**
- Create: `src/app/api/schedule/copy-week/route.ts`
- Create: `tests/integration/api-schedule-copy-week.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import "@/../tests/helpers/auth";
import "@/../tests/setup";
import { db } from "@/lib/db/client";
import { families, users, familyUsers, profiles, meals, scheduleEntries } from "@/lib/db/schema";
import { setMockClerkUser } from "@/../tests/helpers/auth";
import { resetDb } from "@/../tests/helpers/db";
import { POST } from "@/app/api/schedule/copy-week/route";

async function seed() {
  const [family] = await db.insert(families).values({ name: "T", weekStartsOn: 1 }).returning();
  const [user] = await db.insert(users).values({ clerkUserId: "clerk_cw_api", email: "cwa@test" }).returning();
  await db.insert(familyUsers).values({ familyId: family!.id, userId: user!.id });
  const [meal] = await db.insert(meals).values({ familyId: family!.id, name: "Tacos", tags: [] }).returning();
  setMockClerkUser("clerk_cw_api");
  return { family: family!, user: user!, meal: meal! };
}

function post(body: unknown) {
  return new Request("http://test/api/schedule/copy-week", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/schedule/copy-week", () => {
  beforeEach(async () => { await resetDb(); setMockClerkUser(null); });

  it("401 when unauthenticated", async () => {
    const res = await POST(post({ from: "2026-05-04", to: "2026-05-11" }));
    expect(res.status).toBe(401);
  });

  it("copies defaults and returns the target week", async () => {
    const { family, user, meal } = await seed();
    await db.insert(scheduleEntries).values({
      familyId: family.id, date: "2026-05-04", slot: "dinner",
      mealId: meal.id, createdByUserId: user.id, updatedByUserId: user.id,
    });
    const res = await POST(post({ from: "2026-05-04", to: "2026-05-11" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.copied).toBe(1);
    expect(body.week.weekStart).toBe("2026-05-11");
    expect(body.week.days[0].dinner.kind).toBe("meal");
  });

  it("400 on invalid date format", async () => {
    await seed();
    const res = await POST(post({ from: "May 4", to: "2026-05-11" }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/integration/api-schedule-copy-week.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the route**

Create `src/app/api/schedule/copy-week/route.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests**

```bash
pnpm test tests/integration/api-schedule-copy-week.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/schedule/copy-week/route.ts tests/integration/api-schedule-copy-week.test.ts
git commit -m "feat(api): POST /api/schedule/copy-week"
```

---

## Task 12: RSC calendar page + week navigation

**Files:**
- Create: `src/app/app/calendar/page.tsx`
- Create: `src/components/calendar/week-nav.tsx`

For Next.js 16 dynamic search params, `searchParams` is `Promise`-wrapped. Read `node_modules/next/dist/docs/03-app-router/01-getting-started/15-layouts-and-pages.mdx` if uncertain.

- [ ] **Step 1: Create the RSC page**

```tsx
// src/app/app/calendar/page.tsx
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { families, profiles } from "@/lib/db/schema";
import { withFamily } from "@/lib/auth/with-family";
import { resolveWeek } from "@/lib/schedule/resolve";
import { parseISODate, weekStartFor, formatISODate } from "@/lib/schedule/week";
import { WeekNav } from "@/components/calendar/week-nav";
import { ProfileToggle } from "@/components/calendar/profile-toggle";
import { WeekView } from "@/components/calendar/week-view";
import { CopyWeekButton } from "@/components/calendar/copy-week-button";

type Search = { week?: string; profile?: string };

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const { familyId } = await withFamily();

  const [family] = await db.select().from(families).where(eq(families.id, familyId));
  const weekStartsOn = family?.weekStartsOn ?? 0;

  const anyDay = sp.week ? parseISODate(sp.week) : new Date();
  const weekStart = weekStartFor(anyDay, weekStartsOn);
  const profileId = sp.profile && sp.profile !== "default" ? sp.profile : null;

  const week = await resolveWeek(familyId, weekStart, profileId);

  const activeProfiles = await db
    .select({ id: profiles.id, displayName: profiles.displayName, color: profiles.color })
    .from(profiles)
    .where(eq(profiles.familyId, familyId));

  const prev = new Date(weekStart);
  prev.setUTCDate(prev.getUTCDate() - 7);
  const next = new Date(weekStart);
  next.setUTCDate(next.getUTCDate() + 7);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Calendar</h1>
          <ProfileToggle
            profiles={activeProfiles}
            selectedProfileId={profileId}
          />
        </div>
        <div className="flex items-center gap-2">
          <CopyWeekButton fromWeekISO={formatISODate(prev)} toWeekISO={formatISODate(weekStart)} />
          <WeekNav
            prevISO={formatISODate(prev)}
            nextISO={formatISODate(next)}
            weekStartISO={formatISODate(weekStart)}
          />
        </div>
      </header>
      <WeekView week={week} profileColors={Object.fromEntries(activeProfiles.map((p) => [p.id, p.color]))} />
    </div>
  );
}
```

- [ ] **Step 2: Create `WeekNav`**

```tsx
// src/components/calendar/week-nav.tsx
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";

export function WeekNav({
  prevISO,
  nextISO,
  weekStartISO,
}: {
  prevISO: string;
  nextISO: string;
  weekStartISO: string;
}) {
  const sp = useSearchParams();
  const profile = sp.get("profile");
  const qs = (week: string) => {
    const p = new URLSearchParams();
    p.set("week", week);
    if (profile) p.set("profile", profile);
    return `?${p.toString()}`;
  };
  return (
    <div className="flex items-center gap-2">
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/app/calendar${qs(prevISO)}`}>
        ← Prev
      </Link>
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/app/calendar`}>
        Today
      </Link>
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/app/calendar${qs(nextISO)}`}>
        Next →
      </Link>
      <span className="text-muted-foreground ml-2 text-sm">Week of {weekStartISO}</span>
    </div>
  );
}
```

- [ ] **Step 3: Confirm typecheck still passes (page references components not yet built)**

The page imports `WeekView`, `ProfileToggle`, `CopyWeekButton` which don't exist yet. That's expected — we'll add them in Tasks 13–16. Typecheck will fail until then; that's fine for this commit.

Skip `pnpm typecheck` and proceed. (Subagent-driven execution should treat these as intentional gaps to be filled in the next tasks; the reviewer will only run `pnpm typecheck` after Task 16.)

- [ ] **Step 4: Commit the partial page and the WeekNav**

```bash
git add src/app/app/calendar/page.tsx src/components/calendar/week-nav.tsx
git commit -m "feat(calendar): RSC page scaffold + WeekNav"
```

---

## Task 13: `WeekView` responsive container + read-only render path

**Files:**
- Create: `src/components/calendar/week-view.tsx`
- Create: `src/components/calendar/day-agenda.tsx`
- Create: `src/components/calendar/week-grid.tsx`
- Create: `src/components/calendar/slot-cell.tsx`

These render a `ResolvedWeek`. Edits are wired up in Task 14 by passing handlers down.

- [ ] **Step 1: Create `slot-cell.tsx`**

```tsx
// src/components/calendar/slot-cell.tsx
"use client";

import type { ResolvedSlot, MealSlot } from "@/lib/schedule/types";

export function SlotCell({
  slot,
  state,
  hasOverride,
  onClick,
}: {
  slot: MealSlot;
  state: ResolvedSlot;
  hasOverride: boolean;
  onClick: () => void;
}) {
  const label =
    state.kind === "meal"
      ? state.meal.name
      : state.kind === "eat-out"
        ? `🍴 ${state.entry.eatingOutLabel ?? "Eating out"}`
        : "—";
  const isOverride = state.kind !== "empty" && state.source === "override";
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-border hover:bg-muted/50 flex w-full items-center justify-between rounded border px-2 py-1 text-left text-sm"
      aria-label={`Edit ${slot}`}
    >
      <span className="truncate">{label}</span>
      <span className="flex items-center gap-1">
        {state.kind !== "empty" && state.entry.notes && <span aria-label="has note">📝</span>}
        {isOverride && <span className="text-xs text-blue-600">override</span>}
        {!isOverride && hasOverride && <span className="text-xs text-blue-600">•</span>}
      </span>
    </button>
  );
}
```

- [ ] **Step 2: Create `day-agenda.tsx`**

```tsx
// src/components/calendar/day-agenda.tsx
"use client";

import { MEAL_SLOTS, type ResolvedDay } from "@/lib/schedule/types";
import { SlotCell } from "./slot-cell";

const SLOT_LABEL: Record<string, string> = {
  breakfast: "B",
  lunch: "L",
  dinner: "D",
  snack: "S",
};

export function DayAgenda({
  dateISO,
  day,
  overrideSlots,
  onSlotClick,
}: {
  dateISO: string;
  day: ResolvedDay;
  overrideSlots: string[];
  onSlotClick: (slot: (typeof MEAL_SLOTS)[number]) => void;
}) {
  return (
    <section className="rounded border p-3">
      <header className="mb-2 text-sm font-medium">{dateISO}</header>
      <div className="space-y-1">
        {MEAL_SLOTS.map((slot) => (
          <div key={slot} className="grid grid-cols-[24px_1fr] items-center gap-2">
            <span className="text-muted-foreground text-xs">{SLOT_LABEL[slot]}</span>
            <SlotCell
              slot={slot}
              state={day[slot]}
              hasOverride={overrideSlots.includes(slot)}
              onClick={() => onSlotClick(slot)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Create `week-grid.tsx`**

```tsx
// src/components/calendar/week-grid.tsx
"use client";

import { MEAL_SLOTS, type ResolvedWeek } from "@/lib/schedule/types";
import { SlotCell } from "./slot-cell";

const SLOT_LABEL: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

export function WeekGrid({
  week,
  onSlotClick,
}: {
  week: ResolvedWeek;
  onSlotClick: (dateISO: string, slot: (typeof MEAL_SLOTS)[number]) => void;
}) {
  const dates = week.days.map((_, i) => addDays(week.weekStart, i));
  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <thead>
        <tr>
          <th className="w-20 text-left"></th>
          {dates.map((d) => (
            <th key={d} className="border-b px-1 py-1 text-left">
              {d}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {MEAL_SLOTS.map((slot) => (
          <tr key={slot}>
            <th className="text-muted-foreground py-1 pr-2 text-left text-xs">{SLOT_LABEL[slot]}</th>
            {week.days.map((day, i) => {
              const dateISO = dates[i]!;
              return (
                <td key={dateISO} className="p-1 align-top">
                  <SlotCell
                    slot={slot}
                    state={day[slot]}
                    hasOverride={(week.overrideMap[dateISO] ?? []).includes(slot)}
                    onClick={() => onSlotClick(dateISO, slot)}
                  />
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Create `week-view.tsx`**

```tsx
// src/components/calendar/week-view.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MealSlot, ResolvedWeek } from "@/lib/schedule/types";
import { DayAgenda } from "./day-agenda";
import { WeekGrid } from "./week-grid";
import { SlotEditor } from "./slot-editor";

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

type OpenEditor = { dateISO: string; slot: MealSlot } | null;

export function WeekView({
  week,
  profileColors: _profileColors,
}: {
  week: ResolvedWeek;
  profileColors: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<OpenEditor>(null);

  const handleOpen = (dateISO: string, slot: MealSlot) => setOpen({ dateISO, slot });

  return (
    <>
      <div className="md:hidden space-y-3">
        {week.days.map((day, i) => {
          const dateISO = addDays(week.weekStart, i);
          return (
            <DayAgenda
              key={dateISO}
              dateISO={dateISO}
              day={day}
              overrideSlots={week.overrideMap[dateISO] ?? []}
              onSlotClick={(slot) => handleOpen(dateISO, slot)}
            />
          );
        })}
      </div>
      <div className="hidden md:block">
        <WeekGrid week={week} onSlotClick={handleOpen} />
      </div>
      {open && (
        <SlotEditor
          dateISO={open.dateISO}
          slot={open.slot}
          currentState={
            week.days[
              Math.round(
                (Date.UTC(
                  Number(open.dateISO.slice(0, 4)),
                  Number(open.dateISO.slice(5, 7)) - 1,
                  Number(open.dateISO.slice(8, 10)),
                ) -
                  Date.UTC(
                    Number(week.weekStart.slice(0, 4)),
                    Number(week.weekStart.slice(5, 7)) - 1,
                    Number(week.weekStart.slice(8, 10)),
                  )) /
                  (24 * 60 * 60 * 1000),
              )
            ]?.[open.slot] ?? { kind: "empty" }
          }
          onClose={() => setOpen(null)}
          onSaved={() => {
            setOpen(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
```

- [ ] **Step 5: Commit (still typecheck-broken — SlotEditor missing)**

```bash
git add src/components/calendar/
git commit -m "feat(calendar): WeekView responsive layout + read-only render"
```

---

## Task 14: `SlotEditor` modal + `MealPicker` + `EatOutForm` + `NotesInput`

**Files:**
- Create: `src/components/calendar/slot-editor.tsx`
- Create: `src/components/calendar/meal-picker.tsx`
- Create: `src/components/calendar/eat-out-form.tsx`
- Create: `src/components/calendar/notes-input.tsx`

The editor is a single client component that fetches `/api/schedule/entries` or `/api/schedule/entries/[id]` based on whether a row exists. Profile context comes from the URL; we read it via `useSearchParams`.

- [ ] **Step 1: Create `notes-input.tsx`**

```tsx
// src/components/calendar/notes-input.tsx
"use client";

import { useState } from "react";

export function NotesInput({
  initial,
  onChange,
}: {
  initial: string | null;
  onChange: (v: string | null) => void;
}) {
  const [v, setV] = useState(initial ?? "");
  return (
    <input
      type="text"
      placeholder="Notes (optional)"
      value={v}
      maxLength={500}
      onChange={(e) => {
        const next = e.target.value;
        setV(next);
        onChange(next.trim().length > 0 ? next : null);
      }}
      className="w-full rounded border px-2 py-1 text-sm"
    />
  );
}
```

- [ ] **Step 2: Create `eat-out-form.tsx`**

```tsx
// src/components/calendar/eat-out-form.tsx
"use client";

import { useState } from "react";

export function EatOutForm({
  initialCost,
  initialLabel,
  onChange,
}: {
  initialCost: number | null;
  initialLabel: string | null;
  onChange: (cost: number | null, label: string | null) => void;
}) {
  const [cost, setCost] = useState(initialCost?.toString() ?? "");
  const [label, setLabel] = useState(initialLabel ?? "");
  return (
    <div className="space-y-2">
      <input
        type="number"
        step="0.01"
        min="0"
        max="9999.99"
        placeholder="Cost (optional)"
        value={cost}
        onChange={(e) => {
          setCost(e.target.value);
          const n = e.target.value === "" ? null : Number(e.target.value);
          onChange(Number.isFinite(n as number) ? (n as number | null) : null, label.trim() || null);
        }}
        className="w-full rounded border px-2 py-1 text-sm"
      />
      <input
        type="text"
        placeholder="Label (e.g. Chipotle)"
        value={label}
        maxLength={80}
        onChange={(e) => {
          setLabel(e.target.value);
          const n = cost === "" ? null : Number(cost);
          onChange(Number.isFinite(n as number) ? (n as number | null) : null, e.target.value.trim() || null);
        }}
        className="w-full rounded border px-2 py-1 text-sm"
      />
    </div>
  );
}
```

- [ ] **Step 3: Create `meal-picker.tsx`**

```tsx
// src/components/calendar/meal-picker.tsx
"use client";

import { useEffect, useState } from "react";

type MealOption = { id: string; name: string };

export function MealPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (mealId: string | null) => void;
}) {
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<MealOption[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    const ctrl = new AbortController();
    const run = async () => {
      const url = q.trim().length > 0 ? `/api/meals?q=${encodeURIComponent(q)}` : `/api/meals`;
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) return;
        const body = (await res.json()) as { items: MealOption[] };
        if (!cancel) setOptions(body.items.slice(0, 30));
      } catch { /* aborted */ }
    };
    const t = setTimeout(run, 200);
    return () => { cancel = true; ctrl.abort(); clearTimeout(t); };
  }, [q]);

  return (
    <div className="space-y-2">
      <input
        type="text"
        placeholder={selectedName ?? "Search meals…"}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full rounded border px-2 py-1 text-sm"
      />
      <ul className="max-h-48 overflow-auto rounded border">
        {options.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              onClick={() => { onChange(o.id); setSelectedName(o.name); }}
              className={`hover:bg-muted/50 w-full px-2 py-1 text-left text-sm ${value === o.id ? "bg-muted" : ""}`}
            >
              {o.name}
            </button>
          </li>
        ))}
        {options.length === 0 && <li className="text-muted-foreground px-2 py-2 text-sm">No matches</li>}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Create `slot-editor.tsx`**

```tsx
// src/components/calendar/slot-editor.tsx
"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { MealSlot, ResolvedSlot } from "@/lib/schedule/types";
import { Button } from "@/components/ui/button";
import { MealPicker } from "./meal-picker";
import { EatOutForm } from "./eat-out-form";
import { NotesInput } from "./notes-input";

type Mode = "meal" | "eat-out";

export function SlotEditor({
  dateISO,
  slot,
  currentState,
  onClose,
  onSaved,
}: {
  dateISO: string;
  slot: MealSlot;
  currentState: ResolvedSlot;
  onClose: () => void;
  onSaved: () => void;
}) {
  const sp = useSearchParams();
  const profileParam = sp.get("profile");
  const profileId = profileParam && profileParam !== "default" ? profileParam : null;

  const existingId = currentState.kind !== "empty" ? currentState.entry.id : null;
  // If we're viewing a profile and the resolved row is the default, treat the editor
  // as creating an override, not editing the default.
  const isOverrideEdit = profileId !== null && (currentState.kind === "empty" || currentState.source === "override");
  const targetProfileId = profileId;

  const [mode, setMode] = useState<Mode>(currentState.kind === "eat-out" ? "eat-out" : "meal");
  const [mealId, setMealId] = useState<string | null>(
    currentState.kind === "meal" ? currentState.entry.mealId : null,
  );
  const [eatCost, setEatCost] = useState<number | null>(
    currentState.kind === "eat-out" ? currentState.entry.eatingOutCost : null,
  );
  const [eatLabel, setEatLabel] = useState<string | null>(
    currentState.kind === "eat-out" ? currentState.entry.eatingOutLabel : null,
  );
  const [notes, setNotes] = useState<string | null>(
    currentState.kind !== "empty" ? currentState.entry.notes : null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { date: dateISO, slot, notes };
      if (isOverrideEdit) body.profileId = targetProfileId;
      if (mode === "meal") {
        if (!mealId) {
          setError("Pick a meal or switch to Eating out.");
          setSaving(false);
          return;
        }
        body.mealId = mealId;
        body.eatingOut = false;
      } else {
        body.eatingOut = true;
        body.eatingOutCost = eatCost;
        body.eatingOutLabel = eatLabel;
      }

      let res: Response;
      if (existingId && (isOverrideEdit ? currentState.kind !== "empty" && currentState.source === "override" : true)) {
        res = await fetch(`/api/schedule/entries/${existingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch(`/api/schedule/entries`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error?.message ?? "Failed to save");
        setSaving(false);
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function clearSlot() {
    if (!existingId) { onClose(); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/schedule/entries/${existingId}`, { method: "DELETE" });
      if (!res.ok) { setError("Failed to clear"); setSaving(false); return; }
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center">
      <div className="bg-background w-full max-w-md space-y-3 rounded-t-lg p-4 md:rounded-lg">
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold">
            {dateISO} · {slot} {isOverrideEdit && <span className="text-muted-foreground text-xs">(override)</span>}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="flex gap-2">
          <Button size="sm" variant={mode === "meal" ? "default" : "outline"} onClick={() => setMode("meal")}>
            Pick meal
          </Button>
          <Button size="sm" variant={mode === "eat-out" ? "default" : "outline"} onClick={() => setMode("eat-out")}>
            Eating out
          </Button>
        </div>
        {mode === "meal" ? (
          <MealPicker value={mealId} onChange={setMealId} />
        ) : (
          <EatOutForm initialCost={eatCost} initialLabel={eatLabel} onChange={(c, l) => { setEatCost(c); setEatLabel(l); }} />
        )}
        <NotesInput initial={notes} onChange={setNotes} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <footer className="flex items-center justify-between pt-2">
          {existingId && (
            <Button size="sm" variant="outline" onClick={clearSlot} disabled={saving}>
              Clear
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving}>Save</Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/calendar/slot-editor.tsx src/components/calendar/meal-picker.tsx src/components/calendar/eat-out-form.tsx src/components/calendar/notes-input.tsx
git commit -m "feat(calendar): slot editor + meal picker + eat-out + notes"
```

---

## Task 15: `ProfileToggle` and `CopyWeekButton`

**Files:**
- Create: `src/components/calendar/profile-toggle.tsx`
- Create: `src/components/calendar/copy-week-button.tsx`

- [ ] **Step 1: Create `profile-toggle.tsx`**

```tsx
// src/components/calendar/profile-toggle.tsx
"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

type ProfileOption = { id: string; displayName: string; color: string };

export function ProfileToggle({
  profiles,
  selectedProfileId,
}: {
  profiles: ProfileOption[];
  selectedProfileId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function setProfile(value: string) {
    const p = new URLSearchParams(sp.toString());
    if (value === "default") p.delete("profile");
    else p.set("profile", value);
    const qs = p.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`);
  }

  return (
    <select
      value={selectedProfileId ?? "default"}
      onChange={(e) => setProfile(e.target.value)}
      className="rounded border px-2 py-1 text-sm"
      aria-label="View profile"
    >
      <option value="default">Family default</option>
      {profiles.map((p) => (
        <option key={p.id} value={p.id}>{p.displayName}</option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: Create `copy-week-button.tsx`**

```tsx
// src/components/calendar/copy-week-button.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function CopyWeekButton({
  fromWeekISO,
  toWeekISO,
}: {
  fromWeekISO: string;
  toWeekISO: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!confirm(`Copy last week (${fromWeekISO}) into this week (${toWeekISO})?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/schedule/copy-week`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: fromWeekISO, to: toWeekISO }),
      });
      if (res.ok) router.refresh();
      else alert("Copy failed");
    } finally { setBusy(false); }
  }

  return (
    <Button size="sm" variant="outline" onClick={run} disabled={busy}>
      Copy last week
    </Button>
  );
}
```

- [ ] **Step 3: Run typecheck — should now pass**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 4: Run build**

```bash
pnpm build
```

Expected: clean build. The new `/app/calendar` route appears in the route summary.

- [ ] **Step 5: Commit**

```bash
git add src/components/calendar/profile-toggle.tsx src/components/calendar/copy-week-button.tsx
git commit -m "feat(calendar): profile toggle + copy-week button"
```

---

## Task 16: Nav, redirect, and meals header link

**Files:**
- Modify: `src/app/app/layout.tsx`
- Modify: `src/app/app/page.tsx`
- Modify: `src/app/app/meals/page.tsx`

- [ ] **Step 1: Add the Calendar nav link**

Open `src/app/app/layout.tsx`. The existing `<nav>` looks like:

```tsx
<nav className="flex items-center gap-4">
  <Link href="/app/meals" className="text-sm">Recipes</Link>
  <Link href="/app/settings/profiles" className="text-sm">Profiles</Link>
  <UserButton />
</nav>
```

Replace with:

```tsx
<nav className="flex items-center gap-4">
  <Link href="/app/calendar" className="text-sm">Calendar</Link>
  <Link href="/app/meals" className="text-sm">Recipes</Link>
  <Link href="/app/settings/profiles" className="text-sm">Profiles</Link>
  <UserButton />
</nav>
```

- [ ] **Step 2: Redirect /app to /app/calendar**

Replace `src/app/app/page.tsx` with:

```tsx
import { redirect } from "next/navigation";

export default function DashboardPage() {
  redirect("/app/calendar");
}
```

- [ ] **Step 3: Add a "Plan a week →" link to the meals page header**

Open `src/app/app/meals/page.tsx`. The page has a header with the page title and a "New meal" button. Locate the header element and add a `Link` to `/app/calendar` directly to the left of the New meal button. Example shape (paste alongside the existing button):

```tsx
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

// In the JSX header bar:
<Link href="/app/calendar" className={buttonVariants({ variant: "outline", size: "sm" })}>
  Plan a week →
</Link>
```

If the meals page doesn't yet import `Link` or `buttonVariants`, add the imports at the top.

- [ ] **Step 4: Verify build + typecheck**

```bash
pnpm typecheck && pnpm build
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/app/layout.tsx src/app/app/page.tsx src/app/app/meals/page.tsx
git commit -m "feat(nav): add Calendar nav + redirect /app to /app/calendar"
```

---

## Task 17: Empty-states + meal-library-empty guard

**Files:**
- Modify: `src/app/app/calendar/page.tsx`

- [ ] **Step 1: Add a check for "family has zero non-archived meals"**

Update `src/app/app/calendar/page.tsx`. Above the `<WeekView />` render, count meals and render the empty state if zero:

```tsx
import { and, count, eq } from "drizzle-orm";
import { meals } from "@/lib/db/schema";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

// ...inside the function, after withFamily / family lookup:
const [{ value: mealCount }] = await db
  .select({ value: count() })
  .from(meals)
  .where(and(eq(meals.familyId, familyId), eq(meals.isArchived, false)));

if (mealCount === 0) {
  return (
    <div className="mx-auto max-w-md py-12 text-center">
      <h1 className="text-xl font-semibold">No recipes yet</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Build a recipe before you can start planning.
      </p>
      <Link
        href="/app/meals/new"
        className={buttonVariants({ variant: "default", size: "default" }) + " mt-4 inline-block"}
      >
        Create your first recipe →
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
pnpm build
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/app/calendar/page.tsx
git commit -m "feat(calendar): empty-library guard with link to /app/meals/new"
```

---

## Task 18: E2E smoke — sign in, plan a week, override, eat-out

**Files:**
- Modify: `tests/e2e/smoke.spec.ts`

The existing E2E test gates on `E2E_USER_EMAIL` and tests sign-in plus Phase 1's recipe flow. Append a calendar test.

- [ ] **Step 1: Open `tests/e2e/smoke.spec.ts` and append a new test**

Add this test alongside the existing ones, inside the same `describe` (or top-level, matching the file's style):

```ts
test("calendar: plan, override, eat-out, copy-last-week", async ({ page }) => {
  // Pre-req: signed-in session is established by the file's beforeEach (mirror Phase 1's pattern).
  await page.goto("/app/calendar");

  // The page should land on the current week; we don't assert the week date, only the shape.
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();

  // 1. Pick a meal for the first dinner slot
  await page.locator('button[aria-label="Edit dinner"]').first().click();
  await page.getByPlaceholder("Search meals…").fill(""); // load default list
  await page.locator("ul li button").first().click();
  await page.getByRole("button", { name: "Save" }).click();

  // 2. Mark first lunch as eating out
  await page.locator('button[aria-label="Edit lunch"]').first().click();
  await page.getByRole("button", { name: "Eating out" }).click();
  await page.getByPlaceholder("Cost (optional)").fill("12.50");
  await page.getByPlaceholder("Label (e.g. Chipotle)").fill("Chipotle");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("text=🍴")).toBeVisible();

  // 3. Override the first dinner for a specific profile
  // Switch view to a profile via the dropdown
  await page.getByRole("combobox", { name: "View profile" }).selectOption({ index: 1 });
  await page.waitForURL(/profile=/);
  await page.locator('button[aria-label="Edit dinner"]').first().click();
  await page.locator("ul li button").first().click();
  await page.getByRole("button", { name: "Save" }).click();
  // Back to family default
  await page.getByRole("combobox", { name: "View profile" }).selectOption("default");
  await page.waitForURL((u) => !u.searchParams.has("profile"));

  // 4. Copy last week — set the dialog handler BEFORE clicking the trigger
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Copy last week" }).click();
  // Toast / page refresh; just confirm we're still on the calendar
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
});
```

Notes:
- This test depends on the family already having at least one meal (Phase 1's smoke test creates one).
- It also depends on at least one profile being seeded.
- Run order matters: Phase 1's recipe-creation test must precede this one in the same suite/file.

- [ ] **Step 2: Run the smoke suite locally if `E2E_USER_EMAIL` is set**

```bash
E2E_USER_EMAIL=... E2E_USER_PASSWORD=... pnpm test:e2e
```

Expected: all tests including the new calendar test pass.

If the credentials are not available locally, skip the run — CI will catch it.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/smoke.spec.ts
git commit -m "test(e2e): calendar plan + override + eat-out + copy-last-week"
```

---

## Task 19: Manual verification + mobile smoke

**Files:** none.

- [ ] **Step 1: Start the dev server**

```bash
pnpm dev
```

- [ ] **Step 2: Verify the desktop flow**

In Chrome at `http://localhost:3000`:

1. Sign in.
2. Verify the post-sign-in landing is `/app/calendar`.
3. Add at least 2 meals (`/app/meals/new`) — needed for picker + override testing.
4. Pick a meal for Monday dinner; confirm it renders.
5. Mark Tuesday lunch as eating out, with cost and label; confirm the 🍴 badge renders.
6. Toggle the profile dropdown to a specific profile.
7. Override Monday dinner for that profile.
8. Switch back to "Family default" view; confirm the override dot (`•`) shows on Monday dinner.
9. Click "Copy last week" — confirm the prior week's rows appear (the prior week may be empty; just confirm no error).
10. Navigate Prev / Today / Next; confirm the URL `?week=` changes and the page reloads with that week.

- [ ] **Step 3: Verify the mobile layout**

In Chrome DevTools, switch to a mobile viewport (e.g., iPhone 14). Confirm:

1. The calendar collapses to day-stacked agenda.
2. Tapping a slot opens the editor as a bottom sheet.
3. The same flows from Step 2 work.

- [ ] **Step 4: Run the full suite**

```bash
pnpm typecheck && pnpm test && pnpm build
```

Expected: all green.

- [ ] **Step 5: Commit any incidental fixes from verification (if needed)**

If verification surfaced bugs, fix them, commit, then re-run.

If everything passes cleanly, no commit needed.

---

## Task 20: Merge to main + tag

**Files:** none.

- [ ] **Step 1: Confirm we're on a feature branch and main is clean**

```bash
git status
git log --oneline main..HEAD
```

Expected: all Phase 2 commits visible.

- [ ] **Step 2: Merge with a merge commit (not squash) to preserve the task history**

```bash
git checkout main
git merge --no-ff <feature-branch>  -m "Merge phase 2: weekly calendar + overrides"
```

- [ ] **Step 3: Tag the release**

```bash
git tag v0.4.0-weekly-calendar
git push origin main --tags
```

- [ ] **Step 4: Verify the production deploy on Vercel completes green**

Watch the Vercel deployment trigger from the push. Once green, smoke-test on `https://meal-plan.jacobmckinney.com`:

1. Sign in.
2. Navigate to `/app/calendar`.
3. Plan one slot, override one slot, mark one eat-out.
4. Confirm migration ran (the route loads without 500 errors).

- [ ] **Step 5: Done**

Phase 2 is shipped. The handoff for Phase 3 (grocery list) starts from `git log --oneline -1` and the merge commit message.

---

## Notes for the executor

- **AGENTS.md callout:** if any Next-specific API behaves unexpectedly, consult `node_modules/next/dist/docs/` before guessing.
- **The base-ui Button does NOT support `asChild`.** Use `buttonVariants()` on the wrapped element (Phase 1 hit this).
- **Drizzle wraps PG errors in `DrizzleQueryError`.** Read the conflict regex from `err.cause.message`, not `err.message` (Phase 1 hit this).
- **`next build --webpack`** is the build command for production because `@ducanh2912/next-pwa` injects a Webpack config. Don't try to switch to Turbopack for the build.
- **typedRoutes stays disabled** — Clerk's catch-all paths break it.
- **Partial unique indexes:** verify Drizzle's migration generator emitted the `WHERE profile_id IS [NOT] NULL` predicates. If not, hand-edit the migration SQL — they are non-negotiable per the spec.
