# Meal Plan App — Overview Design

**Status:** Draft for review
**Date:** 2026-05-09
**Scope:** Cross-cutting product overview. Each phase below gets its own spec → plan → implementation cycle.

---

## 1. Product summary

A family meal planning PWA. One family curates a meal inventory, plans a weekly calendar with a shared default plus per-profile overrides, derives a grocery list from that plan, tracks eating-out spend, builds a receipt-driven price history per ingredient across stores, and exports printable menus.

The app is multi-tenant-ready from day one (every domain row is `family_id`-scoped) but ships in v1 as single-tenant: families and user-to-family assignments are seeded manually via a TypeScript seed script. A future Clerk Orgs invite flow is anticipated in the data model but not built.

## 2. Tech stack

- **Next.js 16** (App Router, TypeScript, RSC by default)
- **Clerk** for authentication (sessions only; family membership lives in our DB)
- **Neon Postgres** via Vercel Marketplace integration; branch-per-preview enabled
- **Drizzle ORM** for schema, migrations, type-safe queries
- **Vercel Blob** (private) for receipt images
- **Anthropic SDK** server-side, Claude Sonnet 4.6 with vision, for receipt OCR
- **next-pwa** for service worker + manifest, **stale-while-revalidate** read caching
- **Tailwind CSS + shadcn/ui** (mobile-first)
- **Zod** for request/response validation, schemas shared between API and client
- **react-pdf** (`@react-pdf/renderer`) for server-rendered PDF export
- **Vitest** for unit/integration tests, **Playwright** for E2E
- **Vercel Analytics** + **Sentry** for observability

## 3. High-level architecture

- All data operations go through `/app/api/*` route handlers. Client components never touch the database directly.
- Server Components fetch via the same `withFamily`-scoped helpers, no HTTP round-trip.
- Authorization: every API route is wrapped by `withFamily(handler)`, which resolves the Clerk user to a `(userId, familyId)` pair and rejects requests without a family membership.
- Tenant isolation: every domain query filters by `family_id` in application code. No Postgres RLS in v1; mitigated by a typed query wrapper / lint rule. Adding RLS later is a non-breaking change.
- Mutations return the mutated resource. Clients do not refetch after a write.
- Audit columns (`created_by_user_id`, `updated_by_user_id`, `created_at`, `updated_at`) on mutable rows, populated by the API layer.

## 4. Multi-tenancy model

The tenant unit is the **family**. Three identity tables:

```
families(id, name, timezone, week_starts_on, created_at, updated_at)

users(id, clerk_user_id UNIQUE, email, display_name, created_at, updated_at)

family_users(family_id, user_id, joined_at, PRIMARY KEY (family_id, user_id))
```

**Profiles are decoupled from users.** A profile (mom, dad, kid1, kid2) may optionally link to a Clerk-backed user; many profiles will not. Authorization checks `family_users` membership, never `profiles.user_id`.

```
profiles(id, family_id, display_name, color, user_id NULLABLE, is_active, sort_order, created_at, updated_at)
```

For v1 the runtime assumes one family per user. Schema supports many-to-many.

**Forward path to Clerk Orgs:** add `families.clerk_org_id` (nullable, unique). New families created from `organization.created` webhooks; `family_users` rows written from `organizationMembership.created` webhooks. No breaking change.

The `withFamily` helper:

```ts
export async function withFamily(req: Request) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) throw new UnauthorizedError();

  const user = await db.query.users.findFirst({
    where: eq(users.clerkUserId, clerkUserId),
  });
  if (!user) throw new UnauthorizedError();

  const membership = await db.query.familyUsers.findFirst({
    where: eq(familyUsers.userId, user.id),
  });
  if (!membership) throw new ForbiddenError();

  return { userId: user.id, familyId: membership.familyId, db };
}
```

**Authorization model (v1):** flat. Every user in a family can read and write everything. `created_by_user_id` audit columns are populated for forward retrofit. Roles, per-profile permissions, and audit-log UI are explicit deferrals.

## 5. Data model sketch

Each phase spec owns its precise schema. The shape below is the cross-cutting outline. All domain tables include `family_id`, audit columns, and timestamps unless otherwise noted.

### Phase 1 — Meals & ingredients

```
meals(
  id, family_id, name, description, instructions (markdown text),
  prep_time_minutes, cook_time_minutes, servings, source_url,
  image_url (Vercel Blob), is_archived
)

ingredients(
  id, family_id, name, default_unit,
  category enum('produce'|'meat'|'dairy'|'pantry'|'frozen'|'bakery'|'other')
)

meal_ingredients(
  id, meal_id, ingredient_id NULLABLE,
  display_text TEXT,
  quantity NUMERIC NULLABLE, unit TEXT NULLABLE,
  sort_order
  -- CHECK (ingredient_id IS NOT NULL OR display_text IS NOT NULL)
)
```

`meal_ingredients` follows the **hybrid model**: a row may carry a free-text `display_text` (e.g. "a generous handful of basil") and/or a structured `ingredient_id` reference. Quantity and unit are always optional. The display layer renders `display_text` if present, otherwise `quantity unit ingredient.name`. Aggregation and price tracking only consult the structured fields.

### Phase 2 — Schedule

```
meal_slot enum: 'breakfast' | 'lunch' | 'dinner' | 'snack'

schedule_entries(
  id, family_id, date DATE, slot meal_slot,
  profile_id NULLABLE,             -- NULL = family default
  meal_id NULLABLE,
  eating_out BOOLEAN DEFAULT false,
  eating_out_cost NUMERIC(10,2) NULLABLE,
  eating_out_label TEXT NULLABLE,
  notes TEXT NULLABLE
  -- CHECK NOT (meal_id IS NOT NULL AND eating_out = true)
)
-- Two partial unique indexes (Postgres treats NULLs as distinct, so a
-- single UNIQUE on (family_id, date, slot, profile_id) would not enforce
-- single-default-row semantics):
--   UNIQUE (family_id, date, slot) WHERE profile_id IS NULL
--   UNIQUE (family_id, date, slot, profile_id) WHERE profile_id IS NOT NULL
```

The default plan is the set of rows with `profile_id IS NULL`. Overrides are rows with a specific `profile_id`. Resolution:

```
resolveMealForProfileOnDate(family_id, profile_id, date, slot):
  override = SELECT * FROM schedule_entries
             WHERE family_id=? AND date=? AND slot=? AND profile_id=?
  if override exists: return override
  return SELECT * FROM schedule_entries
         WHERE family_id=? AND date=? AND slot=? AND profile_id IS NULL
```

The eating-out flag lives directly on the schedule row, not in a separate table. Whole-family eat-outs modify the default row; per-person eat-outs are overrides. Whole-family eat-out costs are not synthetically split across profiles in v1 — the dashboard treats "family eat-outs" as its own category.

### Phase 3 — Grocery lists

```
grocery_lists(
  id, family_id, name, start_date, end_date,
  generated_at, last_regenerated_at
)

grocery_list_items(
  id, list_id, ingredient_id NULLABLE,
  display_text, quantity NUMERIC NULLABLE, unit TEXT NULLABLE,
  source enum('derived','manual'),
  checked BOOLEAN DEFAULT false,
  source_schedule_entry_ids uuid[]
)
```

Lists are materialized at generation time and remain editable. Manual items survive regeneration. **Regenerate-merge** strategy: drop and re-insert all `source='derived'` rows; preserve `source='manual'` and the `checked` state of any prior derived row whose `(ingredient_id, unit)` still appears in the new derivation.

### Phase 4 — Eating-out spend

No new tables. The dashboard reads `schedule_entries WHERE eating_out = true`, grouped by `profile_id` (NULL = family), `slot`, and date bucket.

### Phase 5 — Receipts & price history

```
stores(
  id, family_id NULLABLE,                -- NULL = global; family_id = family-specific
  canonical_name, aliases TEXT[]
)

receipts(
  id, family_id, store_id, purchased_on DATE,
  blob_url, status enum('uploaded','extracted','reconciled','failed'),
  raw_extraction JSONB,
  uploaded_by_user_id
)

receipt_line_items(
  id, receipt_id, raw_text,
  extracted_name, extracted_unit_price, extracted_total_price,
  extracted_quantity NUMERIC NULLABLE, extracted_unit TEXT NULLABLE,
  resolution enum('pending','matched','ignored'),
  ingredient_id NULLABLE
)

ingredient_line_text_mappings(
  id, family_id, line_text_normalized,
  resolution enum('matched','ignored'),
  ingredient_id NULLABLE,                -- NULL when resolution = 'ignored'
  confidence_count INT DEFAULT 1
  -- UNIQUE (family_id, line_text_normalized)
)

price_history(
  id, family_id, ingredient_id, store_id, receipt_id NULLABLE,
  unit_price NUMERIC(10,2), total_price NUMERIC(10,2),
  quantity NUMERIC NULLABLE, unit TEXT NULLABLE,
  observed_on DATE
)
```

`ingredient_line_text_mappings` is the learning surface: a row with `resolution='matched'` auto-confirms future receipts; a row with `resolution='ignored'` auto-skips items the user has previously dismissed (e.g. household goods). The reconciliation UI both reads from and writes to this table, and exposes an "edit my mappings" admin screen.

`stores` is globally seeded with major retailers (Walmart, Aldi, Target, Costco, Kroger, Publix, Trader Joe's) and family-extendable. Receipt store-name normalization checks family-scoped first, then global.

### Phase 6 — PDF export

Rendering only. No tables.

### Cross-cutting assumptions

- Ingredients are family-scoped (no global ingredient catalog in v1).
- Stores are global-or-family-scoped (small global seed; families add their own).
- No soft-delete anywhere in v1. Hard deletes with FK cascades.
- All planning dates use `DATE`, not timestamps.
- USD-only, en-US, money as `NUMERIC(10,2)`. `families.timezone` is stored but not user-editable in v1.

## 6. Phase boundaries

Each phase ships a deployed slice. No phase depends on a future phase.

### Phase 0 — Foundation

Rails only, no product features.

- Next.js + TypeScript + Tailwind + shadcn scaffolded
- Clerk wired (sign-in, sign-out, protected routes)
- Neon connected via Vercel Marketplace; Drizzle schema for `families`, `users`, `family_users`, `profiles`
- `withFamily` helper + enforced "every domain query takes a `familyId`" pattern
- Seed script (`scripts/seed-family.ts`) accepting JSON config (family name, profile list, Clerk user IDs)
- next-pwa configured: manifest, icons, install prompt, asset cache
- API route conventions documented (auth wrapper, error envelope, Zod validation)
- `GET /api/me` smoke route returning `{ user, family, profiles[] }`
- Profile management UI (CRUD) on a settings page
- Sentry, Vercel Analytics installed
- Vercel preview + production deployments green

**Exit criteria:** a seeded family can log in, see their profiles, add/edit/archive a profile, and install the PWA on iOS and Android.

### Phase 1 — Meal inventory

CRUD on `meals`, `ingredients`, `meal_ingredients`. Mobile-first list / detail / edit screens. Markdown rendering for instructions. Image upload to Vercel Blob.

**Exit criteria:** a family can build a library of 20+ meals with optional ingredients and recipes.

### Phase 2 — Weekly calendar + overrides

Schedule entries, the resolution function, the calendar UI surfacing the default plan with override badges, the per-profile alternate-view toggle, eating-out flag with cost and label.

**Exit criteria:** a family can plan a full week, set per-profile overrides, mark eat-outs with cost, and toggle the view between default and per-profile alternates.

### Phase 3 — Grocery list

Materialized list with derived/manual items, regenerate-merge, check-off. Mobile-optimized "at the store" view. Read-while-offline begins mattering: the active grocery list, current week's schedule, and meal detail pages cache via stale-while-revalidate.

**Exit criteria:** generate a list for a date range, add manual items, check items off offline, regenerate after a schedule change without losing manual items or check state for still-derived items.

### Phase 4 — Eating-out spend dashboard

Pure read-side over Phase 2 data. Charts: in vs. out totals, breakdown by slot, breakdown by profile, 30/90/365-day windows. Server-rendered.

**Exit criteria:** dashboard renders all three time windows with the expected breakdowns.

### Phase 5 — Receipt OCR + price history

Two sub-phases:

- **5a:** Upload → Claude Vision extraction → reconciliation UI → `price_history` writes. Manual confirmation only.
- **5b:** `ingredient_line_text_mappings` for auto-confirm and auto-ignore. "Edit my mappings" admin screen.

**Exit criteria 5a:** upload a Walmart receipt, reconcile every line, see prices recorded against ingredients.
**Exit criteria 5b:** a second receipt of similar items requires under 30% of the clicks of the first.

### Phase 6 — PDF export

Per-day, 3-day, weekly, monthly menu views via react-pdf. Triggered from the calendar with a "Print menu" action. Mobile share-sheet integration.

**Exit criteria:** all four PDF formats render correctly with the family default + selected profile overrides for the chosen date range.

## 7. Prioritized feature list (MoSCoW)

### Must — v1 ships without these = no product

- **[P0]** Clerk auth, family-scoped data access, `withFamily` enforcement
- **[P0]** Profiles CRUD (add/edit/archive, color, sort order)
- **[P0]** Seed script for manual family + user-to-family assignment
- **[P0]** PWA installable on iOS + Android
- **[P1]** Meals CRUD with name, description, instructions (Markdown), prep/cook time, servings, source URL, image
- **[P1]** Ingredients CRUD (canonical, family-scoped)
- **[P1]** Meal-ingredients (hybrid: optional structured ref + display text + optional quantity/unit)
- **[P2]** Weekly calendar UI: default plan view, mobile-first
- **[P2]** Schedule a meal into `(date, slot)` for the family default
- **[P2]** Override a slot for a specific profile
- **[P2]** Toggle between default plan and a specific profile's resolved view
- **[P2]** Mark a slot as "eating out" with cost + optional label
- **[P2]** Surface override badges on the default view (only when overrides exist)
- **[P3]** Generate a grocery list for a date range, materialized
- **[P3]** Add manual items to a grocery list
- **[P3]** Check items off (persists)
- **[P3]** Regenerate-merge: refresh derived items, preserve manual + checked state
- **[P3]** Read-while-offline for active grocery list, current week's schedule, and meal detail
- **[P4]** Spend dashboard: in vs. out, by slot, by profile, 30/90/365-day windows
- **[P5a]** Upload receipt photo to Vercel Blob (private, family-scoped)
- **[P5a]** Server-side Claude Vision extraction → structured line items + store + date
- **[P5a]** Reconciliation UI: per-line match-to-ingredient / create-new / ignore
- **[P5a]** Price history writes on reconciliation save
- **[P5a]** Per-ingredient price history view (table + simple line chart, by store)
- **[P5a]** Global store seed (Walmart, Aldi, Target, Costco, Kroger, Publix, Trader Joe's) so receipt store-name normalization works on day one
- **[P5b]** Learned `line_text → ingredient_id` auto-confirm
- **[P5b]** Learned `line_text → ignored` auto-skip
- **[P5b]** "Edit my mappings" screen
- **[P6]** PDF export: per-day, 3-day, weekly, monthly menu views

### Should — ships in v1 if time allows

- **[P1]** Meal duplicate / "save as new"
- **[P1]** Meal tags (free-text, family-scoped) for filtering
- **[P2]** Drag-to-reschedule on the calendar
- **[P2]** "Copy last week" bulk-populate
- **[P3]** "Add all unchecked to next week's list" carry-over
- **[P5a]** Family-extension UI for adding custom local stores beyond the global seed
- **[P6]** Email-the-PDF action

### Could — v2+ deferrals; schema is ready

- Clerk Orgs invite flow
- Roles (admin / member)
- Per-profile edit permissions
- Full offline editing with sync
- Cross-family price aggregation (privacy + product call)
- Audit log surfaced in UI
- Soft-delete / undo
- Multi-currency / multi-locale
- Custom meal slots beyond the 4 enum values
- Recipe import from URL (auto-extract title + ingredients + instructions)
- Nutrition data
- Shared shopping (multi-user real-time check-off sync)
- Meal ratings
- Calorie / macro tracking

### Won't — v1 explicit no

- Native mobile apps (PWA only)
- AI meal suggestions / "plan my week for me"
- Grocery delivery integration
- Inventory tracking ("we have 2 lbs of chicken in the freezer")

## 8. Glossary

- **Family** — the top-level tenant. All domain data is `family_id`-scoped.
- **User** — a Clerk-authenticated account, mirrored in `users` via `clerk_user_id`.
- **Profile** — a family member who eats. May or may not be linked to a user.
- **Meal** — a recipe-or-dish entity in the inventory. Optional ingredients and Markdown instructions.
- **Ingredient** — a canonical, family-scoped item. The unit of price-history tracking and grocery aggregation.
- **Meal ingredient** — the join row: a meal's use of an ingredient, with optional `display_text`, `quantity`, `unit`.
- **Slot** — a meal time of day. `breakfast | lunch | dinner | snack`.
- **Schedule entry** — one row at `(family_id, date, slot, profile_id)`. `profile_id NULL` = family default.
- **Default plan** — schedule entries with `profile_id IS NULL`.
- **Override** — a schedule entry with `profile_id IS NOT NULL`.
- **Resolved meal for profile P on date D slot S** — override row for P if it exists, else the default row, else nothing.
- **Eating out** — schedule entry with `eating_out = true`. Mutually exclusive with `meal_id`.
- **Grocery list** — a materialized, family-scoped list for a date range with derived and manual items.
- **Derived item** — a `grocery_list_items` row generated from a meal's ingredients in scope. Refreshable.
- **Manual item** — a user-added `grocery_list_items` row. Survives regenerate.
- **Regenerate-merge** — refreshing derived items while preserving manual items and check state for still-derived items.
- **Receipt** — uploaded grocery receipt photo + Claude's structured extraction.
- **Receipt line item** — one row from a receipt's extraction; reconciled to an ingredient or marked ignored.
- **Reconciliation** — mapping receipt line items to canonical ingredients (or ignoring them) and committing to `price_history`.
- **Line text mapping** — learned `(family_id, normalized_line_text) → (ingredient_id | ignored)` row that lets future receipts auto-resolve.
- **Store** — normalized retailer. Globally seeded; family-extendable.
- **Price history** — `(ingredient × store × date)` price observations sourced from receipts.
- **Spend dashboard** — read-only analytics over `eating_out` schedule entries.
- **`withFamily`** — the API/RSC helper that resolves the current Clerk user to a `(user, family)` pair and is the only legitimate path to a `family_id` for queries.

## 9. Cross-cutting concerns

### API conventions

- Routes under `/app/api/...`, REST-shaped (`GET/POST/PATCH/DELETE`), JSON in/out.
- Every handler wrapped by `withFamily`; no route reads `auth()` directly.
- Zod request body validation, schemas colocated with the route, exported for client reuse (shared types via inference).
- Error envelope: `{ error: { code, message, details? } }`. Codes: `unauthorized`, `forbidden`, `not_found`, `validation_failed`, `conflict`, `internal`.
- Success shape: bare object for single resources, `{ items: T[], nextCursor?: string }` for collections. Final shape locked in Phase 0.
- Mutations return the mutated resource. Clients do not refetch.

### Error handling

- Typed exceptions (`UnauthorizedError`, `NotFoundError`, etc.) converted to the envelope by a single `apiHandler` wrapper.
- Client `fetcher` helper throws on non-2xx and surfaces `error.code` for UI branching.
- Boundary cases requiring explicit UI: offline (PWA), stale resource (post-regenerate races on grocery list), Clerk session expiry (redirect to sign-in).
- Server logs include `family_id`, `user_id`, `request_id` (set in `withFamily`).

### Observability

- Vercel Analytics for page-level metrics.
- Sentry for client + server errors (Vercel integration).
- Structured server logs via JSON `console.log`. Vercel Logs is sufficient in v1.

### Testing strategy

- **Unit (Vitest):** schedule resolution, grocery aggregation, price-history math. Highest-value targets.
- **Integration (Vitest + Neon branch DB):** API route handlers with a real DB and a stubbed Clerk session. One DB branch per CI run.
- **E2E (Playwright):** small smoke suite — sign in, install, build a meal, schedule it, override it, generate grocery list, mark eat-out. Runs on PRs and against production nightly.
- No coverage targets. Phase specs list specific tests that ship with that phase.
- Verification before completion is non-negotiable: every phase exit includes a manual mobile-browser smoke pass.

### Performance budgets (rough, not contractual)

- LCP < 2.5s on a mid-range Android over 4G for the calendar page.
- Calendar week view < 200ms server time at p95.
- Receipt extraction < 15s end-to-end for a typical 30-line Walmart receipt.

### Security

- Receipt blob URLs are private; signed URLs minted server-side, scoped by `family_id` ownership check.
- Clerk webhooks (when added in v2) verify signatures.
- `ANTHROPIC_API_KEY` is server-only. No Anthropic calls from the client.
- Tenant isolation is application-layer only in v1. RLS is a forward option, not a v1 requirement.

### Environment variables (Phase 0 will install)

```
DATABASE_URL                       # Neon, via Vercel Marketplace
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
CLERK_WEBHOOK_SECRET               # reserved, unused in v1
ANTHROPIC_API_KEY
BLOB_READ_WRITE_TOKEN              # via Vercel Blob integration
SENTRY_DSN
NEXT_PUBLIC_APP_URL
```

### Reserved-but-unused naming

- `families.clerk_org_id` — for the future Orgs integration
- `family_users.role` — for the future admin/member split

## 10. Assumptions to revisit

These are the calls made during brainstorming that are worth reconfirming as each phase spec lands:

- **Drizzle over Prisma.** Chosen for cold-start and SQL ergonomics. Reconfirm in Phase 0.
- **Application-layer tenant isolation, not Postgres RLS.** Acceptable for v1; RLS available as a non-breaking add later.
- **Family-scoped ingredients (no global catalog).** Reconfirm if/when cross-family price aggregation is reconsidered.
- **Whole-family eat-out cost not split across profiles.** Reconfirm with first dashboard usage.
- **Sentry installed in Phase 0.** Cheap to wire up; defer if budget-sensitive.
- **API success envelope shape (bare object vs `{ data }`).** Locked in Phase 0.
- **`react-pdf` for export.** Reconfirm in Phase 6 against alternatives if rendering quality is poor.

## 11. Out of scope for this overview

- Per-screen UX wireframes (live in phase specs)
- Specific column lengths, indexes, exact migration sequencing (live in phase specs)
- Test plans beyond strategy (live in phase specs)
- API endpoint inventory beyond conventions (live in phase specs)
- Dependency version pinning (lives in `package.json` in Phase 0)
