# Clerk User Sync (Phase 1.5) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `POST /api/clerk/webhooks` to consume Clerk `user.{created,updated,deleted}` events, mirror them to the `users` table, and bootstrap a single-person family + default profile on first sign-up.

**Architecture:** Verify Svix signature via `verifyWebhook` from `@clerk/nextjs/webhooks`. Dispatch on `evt.type`. `user.created` runs an idempotent transaction that inserts user, family, family_users, and one profile. `user.updated` overwrites email + display name on the matching row. `user.deleted` deletes the user row (cascade clears family_users; profile and audit FKs go to NULL). Migration moves four audit FKs from `NO ACTION` to `ON DELETE SET NULL` so the deletion path doesn't error.

**Tech Stack:** Next.js 16 (App Router, webpack build), Drizzle ORM + Neon Postgres, `@clerk/nextjs/webhooks` (which uses Svix under the hood), Vitest for unit + integration tests.

**Source design spec:** [docs/superpowers/specs/2026-05-12-clerk-user-sync-design.md](../specs/2026-05-12-clerk-user-sync-design.md). Read this before starting.

**AGENTS.md callout:** still "This is NOT the Next.js you know." Consult `node_modules/next/dist/docs/` for any Next-specific behavior you're unsure about. Phase 0 hit multiple drift bugs that way.

---

## File map

### Created

```
drizzle/<NNNN>_<auto>.sql                       Audit-FK migration
src/lib/webhooks/display-name.ts                computeDisplayName(first, last, email)
src/app/api/clerk/webhooks/route.ts             POST handler
tests/unit/display-name.test.ts
tests/integration/api-clerk-webhooks.test.ts
tests/helpers/clerk-webhook.ts                  Mocks verifyWebhook
```

### Modified

```
src/lib/db/schema.ts                            4 audit FKs → onDelete: "set null"
src/env.ts                                      CLERK_WEBHOOK_SECRET → CLERK_WEBHOOK_SIGNING_SECRET
.env.example, .env.local                        Rename in both
src/proxy.ts                                    Add "/api/clerk/webhooks" to public matcher
tests/helpers/db.ts                             (no changes needed; resetDb already covers all the tables)
```

---

## Task 1: Audit-FK migration

The Drizzle schema currently leaves `profiles.created_by_user_id`, `profiles.updated_by_user_id`, `meals.created_by_user_id`, and `meals.updated_by_user_id` with implicit `ON DELETE NO ACTION`. As-is, `user.deleted` would fail for any user who has authored a meal or a profile, and Svix will retry forever. Move all four to `ON DELETE SET NULL`.

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: a new `drizzle/<NNNN>_*.sql` migration

- [ ] **Step 1: Update the schema columns**

Edit `src/lib/db/schema.ts`. Find the `profiles` table block and change the audit FK references to add `{ onDelete: "set null" }`:

```ts
createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
```

Apply the same change in the `meals` table block (the same two column names).

- [ ] **Step 2: Generate the migration**

```bash
pnpm db:generate
```

Expected: a new file under `drizzle/`, e.g. `drizzle/0002_<adjective>_<noun>.sql`. Open it and confirm the diff is exactly four `ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT ... ON DELETE SET NULL` statements (or equivalent). No CREATE TABLE statements; no unrelated changes. If anything else appears, revert the schema edit and try again.

- [ ] **Step 3: Apply to local dev DB**

```bash
pnpm db:migrate
```

Verify with:

```bash
docker exec mealplan-postgres psql -U postgres -d mealplan -c "\d+ profiles" | grep -E "created_by_user_id|updated_by_user_id"
```

Expected: each FK line ends with `ON DELETE SET NULL`.

- [ ] **Step 4: Apply to test DB**

```bash
DATABASE_URL="postgres://postgres:postgres@localhost:5433/mealplan_test" pnpm db:migrate
```

Same verification on `mealplan_test`.

- [ ] **Step 5: Typecheck + run existing tests**

```bash
pnpm typecheck && pnpm test
```

Expected: clean typecheck, all 56 existing tests still passing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts drizzle
git commit -m "feat(db): audit FKs ON DELETE SET NULL for users.id"
```

---

## Task 2: Rename `CLERK_WEBHOOK_SECRET` → `CLERK_WEBHOOK_SIGNING_SECRET`

Clerk v7's `verifyWebhook` auto-reads `CLERK_WEBHOOK_SIGNING_SECRET` from env. Our existing env declaration uses the older name `CLERK_WEBHOOK_SECRET` (reserved-but-unused from Phase 0). Rename it so the Clerk helper picks the secret up without an explicit `options.signingSecret` argument.

**Files:**
- Modify: `src/env.ts`, `.env.example`, `.env.local`

- [ ] **Step 1: Rename in `src/env.ts`**

In `src/env.ts`, replace `CLERK_WEBHOOK_SECRET` with `CLERK_WEBHOOK_SIGNING_SECRET` in BOTH the `serverSchema` block and the `processEnv` block. Two occurrences, identical rename:

```ts
// in serverSchema:
CLERK_WEBHOOK_SIGNING_SECRET: z.string().min(1).optional(),

// in processEnv:
CLERK_WEBHOOK_SIGNING_SECRET: blank(process.env.CLERK_WEBHOOK_SIGNING_SECRET),
```

The `blank()` helper that converts empty strings to undefined is already in scope.

- [ ] **Step 2: Rename in `.env.example`**

In `.env.example`, find the `CLERK_WEBHOOK_SECRET=""` line and rename:

```
CLERK_WEBHOOK_SIGNING_SECRET=""
```

- [ ] **Step 3: Rename in `.env.local`**

Same rename in `.env.local`. (This file is gitignored, but consistent naming matters for local dev.)

- [ ] **Step 4: Typecheck + tests**

```bash
pnpm typecheck && pnpm test
```

Expected: clean. No tests reference the old name (only `src/env.ts` did).

- [ ] **Step 5: Commit**

```bash
git add src/env.ts .env.example
git commit -m "chore(env): rename CLERK_WEBHOOK_SECRET to CLERK_WEBHOOK_SIGNING_SECRET"
```

(`.env.local` is gitignored; the local edit is just for your shell.)

---

## Task 3: `computeDisplayName` helper (TDD)

**Files:**
- Create: `src/lib/webhooks/display-name.ts`, `tests/unit/display-name.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/display-name.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeDisplayName } from "@/lib/webhooks/display-name";

describe("computeDisplayName", () => {
  it("uses first + last when both present", () => {
    expect(computeDisplayName("Ada", "Lovelace", "ada@x.com")).toBe("Ada Lovelace");
  });
  it("uses first only when last is empty", () => {
    expect(computeDisplayName("Ada", "", "ada@x.com")).toBe("Ada");
    expect(computeDisplayName("Ada", null, "ada@x.com")).toBe("Ada");
  });
  it("uses email-local-part when no first name", () => {
    expect(computeDisplayName("", "Lovelace", "ada@x.com")).toBe("ada");
    expect(computeDisplayName(null, null, "ada.lovelace@x.com")).toBe("ada.lovelace");
  });
  it("trims whitespace on the inputs", () => {
    expect(computeDisplayName("  Ada  ", "  Lovelace  ", "")).toBe("Ada Lovelace");
  });
  it("clamps to 80 characters", () => {
    const long = "a".repeat(200);
    expect(computeDisplayName(long, "", "x@y.com")).toHaveLength(80);
  });
  it("falls back to 'User' when nothing usable is provided", () => {
    expect(computeDisplayName(null, null, null)).toBe("User");
    expect(computeDisplayName("", "", "")).toBe("User");
  });
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
pnpm test tests/unit/display-name.test.ts
```

Expected: FAIL — `@/lib/webhooks/display-name` module not found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/webhooks/display-name.ts`:

```ts
export function computeDisplayName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  email: string | null | undefined,
): string {
  const first = (firstName ?? "").trim();
  const last = (lastName ?? "").trim();

  let candidate: string;
  if (first && last) {
    candidate = `${first} ${last}`;
  } else if (first) {
    candidate = first;
  } else {
    const localPart = (email ?? "").split("@")[0]?.trim() ?? "";
    candidate = localPart || "User";
  }

  return candidate.slice(0, 80);
}
```

- [ ] **Step 4: Run, confirm green**

```bash
pnpm test tests/unit/display-name.test.ts
```

Expected: 6/6 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/webhooks tests/unit/display-name.test.ts
git commit -m "feat(webhooks): computeDisplayName helper for Clerk user sync"
```

---

## Task 4: Mock helper for `verifyWebhook`

The webhook handler awaits `verifyWebhook(req)` from `@clerk/nextjs/webhooks`. Integration tests need a way to feed in a stubbed event and a way to simulate a bad signature. Add a Vitest module mock helper alongside the existing `tests/helpers/auth.ts`.

**Files:**
- Create: `tests/helpers/clerk-webhook.ts`

- [ ] **Step 1: Create the helper**

Create `tests/helpers/clerk-webhook.ts`:

```ts
import { vi } from "vitest";
import type { WebhookEvent } from "@clerk/backend/webhooks";

let nextEvent: WebhookEvent | null = null;
let nextError: Error | null = null;

export function setMockWebhookEvent(evt: WebhookEvent | null) {
  nextEvent = evt;
  nextError = null;
}

export function setMockWebhookError(err: Error) {
  nextEvent = null;
  nextError = err;
}

vi.mock("@clerk/nextjs/webhooks", () => ({
  verifyWebhook: async (): Promise<WebhookEvent> => {
    if (nextError) throw nextError;
    if (!nextEvent) {
      throw new Error("test setup: setMockWebhookEvent was not called");
    }
    return nextEvent;
  },
}));
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: clean. The `@clerk/backend/webhooks` types are re-exported from `@clerk/nextjs/webhooks` per the v7 package; the import should resolve.

- [ ] **Step 3: Commit**

```bash
git add tests/helpers/clerk-webhook.ts
git commit -m "test(helpers): vitest mock for @clerk/nextjs/webhooks verifyWebhook"
```

---

## Task 5: Webhook route — `user.created` (TDD)

**Files:**
- Create: `src/app/api/clerk/webhooks/route.ts`, `tests/integration/api-clerk-webhooks.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/integration/api-clerk-webhooks.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import "../helpers/clerk-webhook";
import { setMockWebhookEvent, setMockWebhookError } from "../helpers/clerk-webhook";
import { resetDb } from "../helpers/db";
import { db } from "@/lib/db/client";
import { users, families, familyUsers, profiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { POST } from "@/app/api/clerk/webhooks/route";

const ctx = { params: Promise.resolve({}) };

function userCreatedEvent(overrides: {
  id?: string;
  email?: string;
  firstName?: string | null;
  lastName?: string | null;
} = {}) {
  const id = overrides.id ?? "user_2abcdefghijklmnopqrstuvwxyz";
  const email = overrides.email ?? "ada@example.com";
  return {
    type: "user.created" as const,
    data: {
      id,
      email_addresses: [{ id: "idn_1", email_address: email }],
      first_name: overrides.firstName ?? "Ada",
      last_name: overrides.lastName ?? "Lovelace",
    },
  } as unknown as import("@clerk/backend/webhooks").WebhookEvent;
}

beforeEach(async () => {
  await resetDb();
});

describe("POST /api/clerk/webhooks — user.created", () => {
  it("bootstraps user + family + family_users + profile", async () => {
    setMockWebhookEvent(userCreatedEvent({ id: "user_alpha" }));
    const res = await POST(new Request("http://localhost/api/clerk/webhooks", { method: "POST" }), ctx);
    expect(res.status).toBe(200);

    const u = await db.query.users.findFirst({ where: eq(users.clerkUserId, "user_alpha") });
    expect(u).toBeTruthy();
    expect(u!.email).toBe("ada@example.com");
    expect(u!.displayName).toBe("Ada Lovelace");

    const fu = await db.select().from(familyUsers).where(eq(familyUsers.userId, u!.id));
    expect(fu).toHaveLength(1);

    const fam = await db.query.families.findFirst({ where: eq(families.id, fu[0]!.familyId) });
    expect(fam!.name).toBe("Ada Lovelace's Family");

    const profs = await db.select().from(profiles).where(eq(profiles.familyId, fam!.id));
    expect(profs).toHaveLength(1);
    expect(profs[0]!.displayName).toBe("Ada Lovelace");
    expect(profs[0]!.userId).toBe(u!.id);
  });

  it("is idempotent — second delivery does not duplicate any row", async () => {
    setMockWebhookEvent(userCreatedEvent({ id: "user_beta" }));
    await POST(new Request("http://localhost/api/clerk/webhooks", { method: "POST" }), ctx);
    // second delivery, same event
    setMockWebhookEvent(userCreatedEvent({ id: "user_beta" }));
    const res = await POST(new Request("http://localhost/api/clerk/webhooks", { method: "POST" }), ctx);
    expect(res.status).toBe(200);

    const u = await db.select().from(users).where(eq(users.clerkUserId, "user_beta"));
    expect(u).toHaveLength(1);
    const fam = await db.select().from(families);
    expect(fam).toHaveLength(1);
    const profs = await db.select().from(profiles);
    expect(profs).toHaveLength(1);
  });

  it("does not create a new family when the user already had a row", async () => {
    // Simulate the pre-bootstrap state: a users row exists from manual UPDATE,
    // already has family + profile. user.created should be a no-op.
    const [fam] = await db.insert(families).values({ name: "Preexisting" }).returning();
    const [u] = await db
      .insert(users)
      .values({ clerkUserId: "user_gamma", email: "g@x.com", displayName: "Gamma" })
      .returning();
    await db.insert(familyUsers).values({ familyId: fam!.id, userId: u!.id });

    setMockWebhookEvent(userCreatedEvent({ id: "user_gamma", firstName: "Gamma" }));
    const res = await POST(new Request("http://localhost/api/clerk/webhooks", { method: "POST" }), ctx);
    expect(res.status).toBe(200);

    expect(await db.select().from(users)).toHaveLength(1);
    expect(await db.select().from(families)).toHaveLength(1);
    expect(await db.select().from(familyUsers)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
pnpm test tests/integration/api-clerk-webhooks.test.ts
```

Expected: FAIL — `@/app/api/clerk/webhooks/route` not found.

- [ ] **Step 3: Implement the route**

Create `src/app/api/clerk/webhooks/route.ts`:

```ts
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, families, familyUsers, profiles } from "@/lib/db/schema";
import { computeDisplayName } from "@/lib/webhooks/display-name";

type RouteCtx = { params: Promise<Record<string, string>> };

export async function POST(req: Request, _ctx: RouteCtx): Promise<Response> {
  let evt;
  try {
    evt = await verifyWebhook(req);
  } catch (err) {
    console.error("Clerk webhook signature verification failed:", err);
    return new Response("Bad signature", { status: 400 });
  }

  try {
    if (evt.type === "user.created") {
      await handleUserCreated(evt.data);
    }
    // user.updated and user.deleted handlers added in Task 6
    return new Response(null, { status: 200 });
  } catch (err) {
    console.error("Clerk webhook handler error:", { eventType: evt.type, err });
    return new Response("Internal error", { status: 500 });
  }
}

async function handleUserCreated(data: {
  id: string;
  email_addresses: { email_address: string }[];
  first_name: string | null;
  last_name: string | null;
}) {
  const clerkUserId = data.id;
  const email = data.email_addresses[0]?.email_address ?? null;
  const displayName = computeDisplayName(data.first_name, data.last_name, email);

  await db.transaction(async (tx) => {
    // Idempotent insert: ON CONFLICT DO NOTHING means a re-delivery returns no row.
    const inserted = await tx
      .insert(users)
      .values({ clerkUserId, email, displayName })
      .onConflictDoNothing({ target: users.clerkUserId })
      .returning({ id: users.id });

    if (inserted.length === 0) {
      // User already existed. Don't bootstrap again.
      return;
    }
    const userId = inserted[0]!.id;

    // Don't bootstrap a family if the user somehow already has one (defensive).
    const existingMembership = await tx
      .select({ familyId: familyUsers.familyId })
      .from(familyUsers)
      .where(eq(familyUsers.userId, userId))
      .limit(1);
    if (existingMembership.length > 0) return;

    const [family] = await tx
      .insert(families)
      .values({ name: `${displayName}'s Family` })
      .returning({ id: families.id });

    await tx.insert(familyUsers).values({ familyId: family!.id, userId });

    await tx.insert(profiles).values({
      familyId: family!.id,
      displayName,
      color: "#94a3b8",
      userId,
      createdByUserId: userId,
      updatedByUserId: userId,
    });
  });
}
```

- [ ] **Step 4: Run, confirm green**

```bash
pnpm test tests/integration/api-clerk-webhooks.test.ts
```

Expected: 3/3 PASS for the user.created suite.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/clerk/webhooks tests/integration/api-clerk-webhooks.test.ts
git commit -m "feat(api): /api/clerk/webhooks user.created with family bootstrap"
```

---

## Task 6: Webhook route — `user.updated` + `user.deleted` (TDD)

**Files:**
- Modify: `src/app/api/clerk/webhooks/route.ts`, `tests/integration/api-clerk-webhooks.test.ts`

- [ ] **Step 1: Append tests**

Append to `tests/integration/api-clerk-webhooks.test.ts`:

```ts
function userUpdatedEvent(overrides: {
  id: string;
  email?: string;
  firstName?: string | null;
  lastName?: string | null;
}) {
  return {
    type: "user.updated" as const,
    data: {
      id: overrides.id,
      email_addresses: [
        { id: "idn_1", email_address: overrides.email ?? "ada@example.com" },
      ],
      first_name: overrides.firstName ?? null,
      last_name: overrides.lastName ?? null,
    },
  } as unknown as import("@clerk/backend/webhooks").WebhookEvent;
}

function userDeletedEvent(id: string) {
  return {
    type: "user.deleted" as const,
    data: { id, deleted: true },
  } as unknown as import("@clerk/backend/webhooks").WebhookEvent;
}

describe("POST /api/clerk/webhooks — user.updated", () => {
  it("updates email and displayName on the matching row", async () => {
    const [u] = await db
      .insert(users)
      .values({ clerkUserId: "user_delta", email: "old@x.com", displayName: "Old Name" })
      .returning();

    setMockWebhookEvent(
      userUpdatedEvent({ id: "user_delta", email: "new@x.com", firstName: "New", lastName: "Name" }),
    );
    const res = await POST(new Request("http://localhost", { method: "POST" }), ctx);
    expect(res.status).toBe(200);

    const after = await db.query.users.findFirst({ where: eq(users.id, u!.id) });
    expect(after!.email).toBe("new@x.com");
    expect(after!.displayName).toBe("New Name");
  });

  it("returns 200 with no DB change when no matching row exists", async () => {
    setMockWebhookEvent(userUpdatedEvent({ id: "user_does_not_exist", email: "x@x.com" }));
    const res = await POST(new Request("http://localhost", { method: "POST" }), ctx);
    expect(res.status).toBe(200);
    expect(await db.select().from(users)).toEqual([]);
  });
});

describe("POST /api/clerk/webhooks — user.deleted", () => {
  it("deletes the user row, cascades family_users, sets profile.user_id NULL, preserves family", async () => {
    const [fam] = await db.insert(families).values({ name: "Keep" }).returning();
    const [u] = await db
      .insert(users)
      .values({ clerkUserId: "user_eps", email: "e@x.com", displayName: "Eps" })
      .returning();
    await db.insert(familyUsers).values({ familyId: fam!.id, userId: u!.id });
    await db.insert(profiles).values({
      familyId: fam!.id,
      displayName: "Eps",
      color: "#94a3b8",
      userId: u!.id,
      createdByUserId: u!.id,
      updatedByUserId: u!.id,
    });

    setMockWebhookEvent(userDeletedEvent("user_eps"));
    const res = await POST(new Request("http://localhost", { method: "POST" }), ctx);
    expect(res.status).toBe(200);

    expect(await db.select().from(users)).toEqual([]);
    expect(await db.select().from(familyUsers)).toEqual([]);
    const profs = await db.select().from(profiles);
    expect(profs).toHaveLength(1);
    expect(profs[0]!.userId).toBeNull();
    expect(profs[0]!.createdByUserId).toBeNull();
    expect(profs[0]!.updatedByUserId).toBeNull();
    expect(await db.select().from(families)).toHaveLength(1);
  });

  it("is idempotent — second delivery on an already-deleted user returns 200 with no change", async () => {
    setMockWebhookEvent(userDeletedEvent("user_ghost"));
    const res = await POST(new Request("http://localhost", { method: "POST" }), ctx);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
pnpm test tests/integration/api-clerk-webhooks.test.ts -t "user.updated|user.deleted"
```

Expected: FAIL — handlers don't yet dispatch on these event types.

- [ ] **Step 3: Append handlers**

Edit `src/app/api/clerk/webhooks/route.ts`. Inside the `POST` function, expand the dispatch:

```ts
    if (evt.type === "user.created") {
      await handleUserCreated(evt.data);
    } else if (evt.type === "user.updated") {
      await handleUserUpdated(evt.data);
    } else if (evt.type === "user.deleted") {
      await handleUserDeleted(evt.data);
    }
```

Add the two handler functions below `handleUserCreated`:

```ts
async function handleUserUpdated(data: {
  id: string;
  email_addresses: { email_address: string }[];
  first_name: string | null;
  last_name: string | null;
}) {
  const email = data.email_addresses[0]?.email_address ?? null;
  const displayName = computeDisplayName(data.first_name, data.last_name, email);

  const updated = await db
    .update(users)
    .set({ email, displayName, updatedAt: new Date() })
    .where(eq(users.clerkUserId, data.id))
    .returning({ id: users.id });

  if (updated.length === 0) {
    console.warn("Clerk webhook user.updated: no matching user row", { clerkUserId: data.id });
  }
}

async function handleUserDeleted(data: { id: string }) {
  await db.delete(users).where(eq(users.clerkUserId, data.id));
}
```

- [ ] **Step 4: Run, confirm green**

```bash
pnpm test tests/integration/api-clerk-webhooks.test.ts
```

Expected: full suite passing (5 tests so far: 3 for user.created + 2 for user.updated, 2 for user.deleted = 7 total).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/clerk/webhooks/route.ts tests/integration/api-clerk-webhooks.test.ts
git commit -m "feat(api): user.updated + user.deleted handlers"
```

---

## Task 7: Signature verification + unknown event (TDD)

**Files:**
- Modify: `tests/integration/api-clerk-webhooks.test.ts`

- [ ] **Step 1: Append tests**

Append to `tests/integration/api-clerk-webhooks.test.ts`:

```ts
describe("POST /api/clerk/webhooks — security and routing", () => {
  it("returns 400 when signature verification fails", async () => {
    setMockWebhookError(new Error("bad signature"));
    const res = await POST(new Request("http://localhost", { method: "POST" }), ctx);
    expect(res.status).toBe(400);
    expect(await db.select().from(users)).toEqual([]);
  });

  it("returns 200 with no DB change for an unhandled event type", async () => {
    setMockWebhookEvent({
      type: "session.created",
      data: { id: "sess_zzz" },
    } as unknown as import("@clerk/backend/webhooks").WebhookEvent);
    const res = await POST(new Request("http://localhost", { method: "POST" }), ctx);
    expect(res.status).toBe(200);
    expect(await db.select().from(users)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, confirm green**

```bash
pnpm test tests/integration/api-clerk-webhooks.test.ts
```

Expected: all suites passing (7 + 2 = 9 tests). The signature failure case relies on Task 5's existing try/catch around `verifyWebhook`. The unknown-event case relies on the absence of any matching branch (handler falls through to `return 200`).

If the signature test fails, check that the route's try/catch around `verifyWebhook` returns `400`, not 500.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/api-clerk-webhooks.test.ts
git commit -m "test(api): clerk webhook signature failure and unknown event"
```

---

## Task 8: Make the webhook route public in the proxy

The Clerk proxy currently auth-protects everything outside `/`, `/sign-in(.*)`, `/sign-up(.*)`, and `/monitoring(.*)`. Clerk POSTs to the webhook from its edge with no Clerk session, so the path must be whitelisted.

**Files:**
- Modify: `src/proxy.ts`

- [ ] **Step 1: Add the route to `isPublicRoute`**

Replace the `isPublicRoute` matcher in `src/proxy.ts`:

```ts
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  // Sentry's browser SDK tunnels events through this rewrite (configured via
  // `tunnelRoute` in next.config.ts). Must bypass auth or client errors never
  // reach Sentry in production.
  "/monitoring(.*)",
  // Clerk delivers webhooks server-to-server; no Clerk session is present.
  // Authentication of the request is handled inside the route via Svix
  // signature verification.
  "/api/clerk/webhooks",
]);
```

- [ ] **Step 2: Build to confirm the proxy compiles**

```bash
pnpm build
```

Expected: clean build. The new route `/api/clerk/webhooks` should appear in the route listing alongside the existing Phase 0 + Phase 1 routes.

- [ ] **Step 3: Run the full test suite**

```bash
pnpm test
```

Expected: all tests pass — 56 from prior phases plus 9 new ones from this phase = 65 total.

- [ ] **Step 4: Commit**

```bash
git add src/proxy.ts
git commit -m "feat(proxy): allow Clerk webhook POSTs without auth"
```

---

## Task 9: Production cutover (instructions only — no code)

This task has no commits. It's the sequence of human steps to ship the webhook safely without breaking the existing single user (you).

- [ ] **Step 1: Fix your existing user record FIRST**

Before the webhook deploys, your account in Neon prod needs to be updated to your new production Clerk user id. Otherwise after deploy the webhook won't retroactively fix you — it only fires on future events.

Get your prod Clerk user id from the Clerk dashboard (Users → your row → ID, looks like `user_2...`).

Get your old (dev-instance) clerk_user_id from Neon. Pick one of:
- `pnpm db:studio` against the prod DATABASE_URL, then read the `users` table; OR
- `psql` directly via the unpooled Neon URL.

Run the update (manually, via your tool of choice) against the prod DB:

```sql
UPDATE users
   SET clerk_user_id = '<new_prod_clerk_user_id>'
 WHERE clerk_user_id = '<old_dev_clerk_user_id>';
```

Reload `/app` — should now work end-to-end.

- [ ] **Step 2: Push branch + deploy**

```bash
git push
```

GitHub Actions CI runs; Vercel deploys to production with the audit-FK migration running first via `vercel-build`. Confirm the deploy goes Ready and the new route `/api/clerk/webhooks` appears in the build output.

- [ ] **Step 3: Configure the Clerk webhook**

In Clerk's production instance dashboard:
1. Webhooks → Add endpoint.
2. URL: `https://meal-plan.jacobmckinney.com/api/clerk/webhooks`.
3. Subscribe to: `user.created`, `user.updated`, `user.deleted`.
4. Copy the Signing Secret.

In Vercel project settings → Environment Variables, for both **Production** and **Preview**:
5. Add `CLERK_WEBHOOK_SIGNING_SECRET = <secret>`.

Redeploy production (push an empty commit, or use Vercel's "Redeploy" action). New env values only apply to new builds.

- [ ] **Step 4: Smoke**

In the Clerk dashboard's Webhook Logs, click "Send test" on `user.created` and confirm:
- The endpoint returned `200`.
- Sentry stays quiet (no new errors on the route).
- (Optional) tail Vercel function logs for the structured `console.log` from the handler.

Then create a brand-new test account via your prod sign-up flow:
- It receives a `user.created` from Clerk.
- New rows in `users`, `families`, `family_users`, `profiles` in Neon prod.
- Test account lands on `/app` with one profile already visible at `/app/settings/profiles`.

Delete the test account (Clerk dashboard → Users → delete) and confirm `user.deleted` removes the `users` row but leaves the family + profile intact (with `user_id`, `created_by_user_id`, `updated_by_user_id` all NULL on the profile).

If anything in this smoke fails, Sentry will have the stack. Diagnose, fix, redeploy.
