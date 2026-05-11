# Phase 0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the rails for the meal-plan-app: a Next.js 16 + Clerk + Neon Postgres + Drizzle + PWA project with family-scoped data access, profile CRUD, and green deployments to Vercel — no product features yet.

**Architecture:** App Router + RSC by default. Clerk for auth sessions; family membership lives in our DB. Drizzle for schema and queries. Every API route is wrapped by a `withFamily` helper that resolves the Clerk user to a `(userId, familyId)` pair and rejects requests without family membership. The error envelope, request validation (Zod), and audit-column population are centralized in an `apiHandler` wrapper. PWA is installable with a stale-while-revalidate read cache.

**Tech Stack:** Next.js 16, TypeScript, Tailwind CSS, shadcn/ui, Clerk, Neon Postgres, Drizzle ORM + drizzle-kit, Zod, next-pwa, Sentry, Vercel Analytics, Vitest, Playwright, pnpm, Docker (for local Postgres in tests).

**Spec:** `docs/superpowers/specs/2026-05-09-meal-plan-app-overview-design.md`

---

## File structure (created or modified across this phase)

```
.
├── .env.example                        # documented env vars
├── .gitignore                          # standard Node + Next
├── .nvmrc                              # node version pin
├── docker-compose.yml                  # local Postgres for tests
├── drizzle.config.ts                   # drizzle-kit config
├── next.config.ts                      # next-pwa, sentry wrap
├── package.json                        # pnpm scripts + deps
├── playwright.config.ts                # E2E config
├── postcss.config.mjs                  # Tailwind v4 PostCSS
├── pnpm-lock.yaml                      # generated
├── tsconfig.json                       # strict TS
├── vitest.config.ts                    # unit + integration
├── public/
│   ├── manifest.webmanifest            # PWA manifest
│   ├── icon-192.png                    # PWA icon
│   ├── icon-512.png                    # PWA icon
│   └── apple-touch-icon.png
├── src/
│   ├── middleware.ts                   # Clerk middleware + protected matcher
│   ├── instrumentation.ts              # Sentry init
│   ├── instrumentation-client.ts       # Sentry client init
│   ├── env.ts                          # validated env (zod)
│   ├── app/
│   │   ├── layout.tsx                  # ClerkProvider, fonts, manifest link
│   │   ├── globals.css                 # Tailwind + shadcn tokens
│   │   ├── page.tsx                    # landing → redirects to /app if signed in
│   │   ├── sign-in/[[...sign-in]]/page.tsx
│   │   ├── sign-up/[[...sign-up]]/page.tsx
│   │   ├── app/                        # /app URL prefix (not a route group)
│   │   │   ├── layout.tsx              # protected layout, requires auth
│   │   │   ├── page.tsx                # dashboard placeholder
│   │   │   └── settings/profiles/page.tsx
│   │   └── api/
│   │       ├── me/route.ts             # GET /api/me
│   │       └── profiles/
│   │           ├── route.ts            # GET, POST
│   │           └── [id]/route.ts       # PATCH, DELETE
│   ├── lib/
│   │   ├── db/
│   │   │   ├── client.ts               # Drizzle client + pool
│   │   │   └── schema.ts               # families, users, family_users, profiles
│   │   ├── auth/
│   │   │   ├── errors.ts               # typed exceptions
│   │   │   ├── api-handler.ts          # apiHandler wrapper (error envelope)
│   │   │   └── with-family.ts          # withFamily helper
│   │   ├── validation/
│   │   │   └── profile.ts              # Zod schemas for profile API
│   │   └── http/
│   │       └── fetcher.ts              # client fetch helper
│   └── components/
│       ├── ui/                         # shadcn primitives (button, input, etc)
│       ├── profile-list.tsx
│       ├── profile-form.tsx
│       └── install-prompt.tsx          # PWA install banner
├── drizzle/
│   └── 0000_init.sql                   # generated initial migration
├── scripts/
│   ├── seed-family.ts                  # CLI seed
│   └── seed-config.example.json
├── tests/
│   ├── setup.ts                        # vitest global setup (test DB, env)
│   ├── helpers/
│   │   ├── db.ts                       # truncate-and-reset helper
│   │   └── auth.ts                     # mock Clerk session
│   ├── unit/
│   │   ├── api-handler.test.ts
│   │   └── with-family.test.ts
│   ├── integration/
│   │   ├── api-me.test.ts
│   │   └── api-profiles.test.ts
│   └── e2e/
│       └── smoke.spec.ts
└── .github/
    └── workflows/
        └── ci.yml                      # lint, typecheck, unit, integration, e2e
```

---

## Conventions (apply to every task)

- **Branch:** work on `phase-0-foundation` (or current main if greenfield).
- **Commits:** conventional commits (`feat:`, `chore:`, `test:`, `docs:`).
- **Tests:** TDD wherever there is logic. Pure scaffolding tasks (Next.js init, install Clerk) are exempt.
- **Imports:** path alias `@/*` → `src/*`.
- **Files:** create with the exact paths shown. Don't move them around.
- **Don't skip steps:** even "run the test and confirm it fails" is its own checkbox.

---

## Task 1: Initialize Next.js 16 project

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `postcss.config.mjs`, `.gitignore`, `.nvmrc`, `next-env.d.ts`

- [ ] **Step 1: Run the Next.js scaffolder**

```bash
pnpm dlx create-next-app@latest . \
  --typescript \
  --tailwind \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --no-eslint \
  --use-pnpm \
  --turbopack \
  --skip-install \
  --yes
```

Expected: project files created in current directory. The scaffolder may complain that the directory is non-empty due to `docs/`. If it does, pass `--force` to the same command and re-run.

- [ ] **Step 2: Pin Node version**

Create `.nvmrc`:

```
24
```

- [ ] **Step 3: Install dependencies**

```bash
pnpm install
```

Expected: `node_modules/` populated, `pnpm-lock.yaml` created.

- [ ] **Step 4: Verify dev server boots**

```bash
pnpm dev
```

Open `http://localhost:3000`. Expected: default Next.js landing page renders. Stop the dev server with Ctrl+C.

- [ ] **Step 5: Verify build passes**

```bash
pnpm build
```

Expected: `✓ Compiled successfully`. No type errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold next.js 16 + typescript + tailwind"
```

---

## Task 2: Add path alias + strict TS settings

**Files:**
- Modify: `tsconfig.json`

- [ ] **Step 1: Tighten tsconfig**

Open `tsconfig.json` and ensure the `compilerOptions` block contains:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
pnpm exec tsc --noEmit
```

Expected: no output (clean exit).

- [ ] **Step 3: Commit**

```bash
git add tsconfig.json
git commit -m "chore: enable strict typescript + noUncheckedIndexedAccess"
```

---

## Task 3: Install and initialize shadcn/ui

**Files:**
- Modify: `src/app/globals.css`, `tailwind.config.ts` (if Tailwind v3) or `globals.css` (if v4)
- Create: `components.json`, `src/components/ui/button.tsx`, `src/components/ui/input.tsx`, `src/components/ui/label.tsx`, `src/components/ui/card.tsx`, `src/lib/utils.ts`

- [ ] **Step 1: Initialize shadcn**

```bash
pnpm dlx shadcn@latest init --yes --base-color slate
```

Accept all defaults. Expected: `components.json` created, `src/lib/utils.ts` created, `globals.css` updated with shadcn tokens.

- [ ] **Step 2: Add base UI primitives we'll need in this phase**

```bash
pnpm dlx shadcn@latest add button input label card form sonner --yes
```

Expected: files appear under `src/components/ui/`.

- [ ] **Step 3: Verify build still passes**

```bash
pnpm build
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: add shadcn/ui with base primitives"
```

---

## Task 4: Set up environment variable validation

**Files:**
- Create: `src/env.ts`, `.env.example`
- Modify: `.gitignore` (ensure `.env.local` is ignored — it should be by default)

- [ ] **Step 1: Install zod**

```bash
pnpm add zod
```

- [ ] **Step 2: Write the env validator**

Create `src/env.ts`:

```ts
import { z } from "zod";

const serverSchema = z.object({
  DATABASE_URL: z.string().url(),
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_WEBHOOK_SECRET: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),
  SENTRY_DSN: z.string().url().optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

const clientSchema = z.object({
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url(),
});

const processEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  CLERK_WEBHOOK_SECRET: process.env.CLERK_WEBHOOK_SECRET,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
  SENTRY_DSN: process.env.SENTRY_DSN,
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
};

const isServer = typeof window === "undefined";
const merged = serverSchema.merge(clientSchema);
const parsed = isServer ? merged.safeParse(processEnv) : clientSchema.safeParse(processEnv);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables");
}

export const env = parsed.data as z.infer<typeof merged>;
```

- [ ] **Step 3: Document env vars**

Create `.env.example`:

```
# Postgres connection (Neon in prod/preview, local Postgres in dev)
DATABASE_URL="postgres://postgres:postgres@localhost:5432/mealplan"

# Clerk (https://dashboard.clerk.com)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=""
CLERK_SECRET_KEY=""
CLERK_WEBHOOK_SECRET=""

# Anthropic (Phase 5+, optional in Phase 0)
ANTHROPIC_API_KEY=""

# Vercel Blob (Phase 5+, optional in Phase 0)
BLOB_READ_WRITE_TOKEN=""

# Sentry
SENTRY_DSN=""

# App
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

- [ ] **Step 4: Create local env**

```bash
cp .env.example .env.local
```

Then fill in `DATABASE_URL` (we'll set up Postgres in Task 8) and Clerk keys (we'll set up Clerk in Task 6). Leave others blank for now.

- [ ] **Step 5: Commit**

```bash
git add src/env.ts .env.example
git commit -m "chore: add zod-validated env loader"
```

---

## Task 5: Configure Vitest for unit and integration tests

**Files:**
- Create: `vitest.config.ts`, `tests/setup.ts`
- Modify: `package.json` (add test scripts)

- [ ] **Step 1: Install Vitest and helpers**

```bash
pnpm add -D vitest @vitest/coverage-v8 happy-dom @types/node tsx
```

- [ ] **Step 2: Create Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    testTimeout: 15_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

- [ ] **Step 3: Create test setup file**

Create `tests/setup.ts`:

```ts
import { config } from "dotenv";
import path from "node:path";

config({ path: path.resolve(process.cwd(), ".env.test"), override: true });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set for tests (see .env.test)");
}
```

Then create `.env.test`:

```
DATABASE_URL="postgres://postgres:postgres@localhost:5432/mealplan_test"
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_dummy"
CLERK_SECRET_KEY="sk_test_dummy"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
NODE_ENV="test"
```

Add `.env.test` to `.gitignore` only if it contains real secrets — for our case it has dummies, so commit it.

- [ ] **Step 4: Add test scripts to package.json**

In `package.json`, add to the `scripts` block:

```json
{
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "typecheck": "tsc --noEmit",
    "lint": "next lint"
  }
}
```

- [ ] **Step 5: Verify Vitest runs (with no tests yet)**

```bash
pnpm test
```

Expected: "No test files found" — that's fine, it confirms config loads.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts tests/setup.ts .env.test package.json
git commit -m "chore: configure vitest for unit + integration tests"
```

---

## Task 6: Install and configure Clerk

**Files:**
- Modify: `src/app/layout.tsx`, `package.json`
- Create: `src/middleware.ts`, `src/app/sign-in/[[...sign-in]]/page.tsx`, `src/app/sign-up/[[...sign-up]]/page.tsx`

- [ ] **Step 1: Create a Clerk application**

Go to `https://dashboard.clerk.com`, create a new application named "Meal Plan Dev". Copy the publishable key and secret key into `.env.local`:

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
CLERK_SECRET_KEY="sk_test_..."
```

- [ ] **Step 2: Install Clerk**

```bash
pnpm add @clerk/nextjs
```

- [ ] **Step 3: Wrap the root layout in `<ClerkProvider>`**

Replace `src/app/layout.tsx` with:

```tsx
import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "Meal Plan",
  description: "Family meal planning",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
```

- [ ] **Step 4: Add Clerk middleware**

Create `src/middleware.ts`:

```ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|.*\\..*).*)",
    "/(api|trpc)(.*)",
  ],
};
```

- [ ] **Step 5: Add sign-in and sign-up pages**

Create `src/app/sign-in/[[...sign-in]]/page.tsx`:

```tsx
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <SignIn />
    </main>
  );
}
```

Create `src/app/sign-up/[[...sign-up]]/page.tsx`:

```tsx
import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <SignUp />
    </main>
  );
}
```

- [ ] **Step 6: Verify sign-in works locally**

```bash
pnpm dev
```

Open `http://localhost:3000/sign-up`, create a test account. Expected: Clerk's sign-up flow renders, account creation succeeds, browser redirects to `/`. Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: integrate clerk auth with sign-in and sign-up routes"
```

---

## Task 7: Add protected app shell + landing page

**Files:**
- Modify: `src/app/page.tsx`
- Create: `src/app/app/layout.tsx`, `src/app/app/page.tsx`

- [ ] **Step 1: Replace landing page with a redirect-aware variant**

Replace `src/app/page.tsx`:

```tsx
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";

export default async function LandingPage() {
  const { userId } = await auth();
  if (userId) redirect("/app");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-3xl font-semibold">Meal Plan</h1>
      <p className="text-muted-foreground">Family meal planning, made simple.</p>
      <div className="flex gap-3">
        <Button asChild>
          <Link href="/sign-up">Get started</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Add a protected layout**

Create `src/app/app/layout.tsx`:

```tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import Link from "next/link";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <Link href="/app" className="font-semibold">Meal Plan</Link>
        <nav className="flex items-center gap-4">
          <Link href="/app/settings/profiles" className="text-sm">Profiles</Link>
          <UserButton afterSignOutUrl="/" />
        </nav>
      </header>
      <main className="px-4 py-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 3: Add a dashboard placeholder**

Create `src/app/app/page.tsx`:

```tsx
export default function DashboardPage() {
  return (
    <div>
      <h2 className="text-xl font-semibold">Welcome</h2>
      <p className="text-muted-foreground mt-2">
        Phase 0 foundation. Product features arrive in Phase 1+.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Verify the redirect works**

```bash
pnpm dev
```

- Visit `/` while signed out → see landing page.
- Visit `/app` while signed out → redirected to `/sign-in`.
- Sign in → visit `/` → redirected to `/app`.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add protected /app shell with header and sign-out"
```

---

## Task 8: Provision local Postgres and install Drizzle

**Files:**
- Create: `docker-compose.yml`, `drizzle.config.ts`, `src/lib/db/client.ts`
- Modify: `package.json` (add db scripts)

- [ ] **Step 1: Create docker-compose for local Postgres**

Create `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16
    container_name: mealplan-postgres
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: mealplan
    ports:
      # Host port 5433 to avoid clashing with another local postgres (see .env.local).
      - "5433:5432"
    volumes:
      - mealplan_pgdata:/var/lib/postgresql/data

volumes:
  mealplan_pgdata:
```

- [ ] **Step 2: Start Postgres**

```bash
docker compose up -d
```

Then create the test database (separate from dev):

```bash
docker exec mealplan-postgres psql -U postgres -c "CREATE DATABASE mealplan_test;"
```

Expected: `CREATE DATABASE`.

- [ ] **Step 3: Install Drizzle**

```bash
pnpm add drizzle-orm pg
pnpm add -D drizzle-kit @types/pg
```

- [ ] **Step 4: Create the Drizzle client**

Create `src/lib/db/client.ts`:

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/env";
import * as schema from "./schema";

const pool = new Pool({ connectionString: env.DATABASE_URL });

export const db = drizzle(pool, { schema });
export type Db = typeof db;
```

(Schema file comes in Task 9 — this import will fail until then. That's expected; we'll wire them together.)

- [ ] **Step 5: Create a placeholder schema so the import resolves**

Create `src/lib/db/schema.ts`:

```ts
// Schema is defined in Task 9. This placeholder exists so the client
// in Task 8 can be committed without a broken import.
export {};
```

- [ ] **Step 6: Create drizzle-kit config**

Create `drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});
```

- [ ] **Step 7: Add db scripts**

In `package.json`, add to `scripts`:

```json
{
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio",
    "db:push": "drizzle-kit push"
  }
}
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: provision local postgres + install drizzle"
```

---

## Task 9: Define identity schema (families, users, family_users, profiles)

**Files:**
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: Replace the placeholder with the real schema**

Replace the entire contents of `src/lib/db/schema.ts`:

```ts
import {
  pgTable,
  uuid,
  text,
  timestamp,
  smallint,
  boolean,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const families = pgTable("families", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("America/New_York"),
  weekStartsOn: smallint("week_starts_on").notNull().default(0),
  clerkOrgId: text("clerk_org_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull().unique(),
    email: text("email"),
    displayName: text("display_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clerkIdx: uniqueIndex("users_clerk_user_id_idx").on(table.clerkUserId),
  }),
);

export const familyUsers = pgTable(
  "family_users",
  {
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.familyId, table.userId] }),
    userIdx: index("family_users_user_id_idx").on(table.userId),
  }),
);

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    color: text("color").notNull().default("#94a3b8"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: smallint("sort_order").notNull().default(0),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    familyIdx: index("profiles_family_id_idx").on(table.familyId),
  }),
);

export type Family = typeof families.$inferSelect;
export type NewFamily = typeof families.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type FamilyUser = typeof familyUsers.$inferSelect;
export type NewFamilyUser = typeof familyUsers.$inferInsert;
export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;

// Suppress unused-import warning for the sql template tag — reserved for
// future check constraints / generated columns added in later phases.
void sql;
```

- [ ] **Step 2: Generate the migration**

```bash
pnpm db:generate
```

Expected: a file appears at `drizzle/0000_<adjective>_<noun>.sql` containing `CREATE TABLE` statements for `families`, `users`, `family_users`, `profiles`. Check that the file exists.

- [ ] **Step 3: Apply the migration to the dev database**

```bash
pnpm db:migrate
```

Expected: migrations run successfully against the local `mealplan` database.

- [ ] **Step 4: Apply the migration to the test database**

```bash
DATABASE_URL="postgres://postgres:postgres@localhost:5433/mealplan_test" pnpm db:migrate
```

Expected: same migrations run against `mealplan_test`.

- [ ] **Step 5: Verify schema in dev DB**

```bash
docker exec mealplan-postgres psql -U postgres -d mealplan -c "\dt"
```

Expected: rows for `families`, `users`, `family_users`, `profiles`, and a Drizzle `__drizzle_migrations` table.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(db): add identity schema (families, users, family_users, profiles)"
```

---

## Task 10: Build typed errors

**Files:**
- Create: `src/lib/auth/errors.ts`, `tests/unit/api-handler.test.ts` (skeleton — full tests in Task 11)

- [ ] **Step 1: Define typed exceptions**

Create `src/lib/auth/errors.ts`:

```ts
export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation_failed"
  | "conflict"
  | "internal";

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = "Authentication required") {
    super("unauthorized", 401, message);
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = "Forbidden") {
    super("forbidden", 403, message);
  }
}

export class NotFoundError extends ApiError {
  constructor(message = "Not found") {
    super("not_found", 404, message);
  }
}

export class ValidationError extends ApiError {
  constructor(message = "Validation failed", details?: unknown) {
    super("validation_failed", 400, message, details);
  }
}

export class ConflictError extends ApiError {
  constructor(message = "Conflict") {
    super("conflict", 409, message);
  }
}
```

- [ ] **Step 2: Commit (test for these comes in Task 11 alongside apiHandler)**

```bash
git add src/lib/auth/errors.ts
git commit -m "feat(api): add typed api error classes"
```

---

## Task 11: Build apiHandler wrapper (TDD)

**Files:**
- Create: `tests/unit/api-handler.test.ts`, `src/lib/auth/api-handler.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/api-handler.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { apiHandler } from "@/lib/auth/api-handler";
import {
  UnauthorizedError,
  NotFoundError,
  ValidationError,
} from "@/lib/auth/errors";

function makeRequest() {
  return new Request("http://localhost/test");
}

describe("apiHandler", () => {
  it("returns the handler's resolved value as 200 JSON", async () => {
    const handler = apiHandler(async () => ({ hello: "world" }));
    const res = await handler(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hello: "world" });
  });

  it("returns 204 when handler resolves to undefined", async () => {
    const handler = apiHandler(async () => undefined);
    const res = await handler(makeRequest());
    expect(res.status).toBe(204);
  });

  it("converts UnauthorizedError to 401 with envelope", async () => {
    const handler = apiHandler(async () => {
      throw new UnauthorizedError();
    });
    const res = await handler(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({
      error: { code: "unauthorized", message: "Authentication required" },
    });
  });

  it("converts NotFoundError to 404 with custom message", async () => {
    const handler = apiHandler(async () => {
      throw new NotFoundError("Profile not found");
    });
    const res = await handler(makeRequest());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "not_found", message: "Profile not found" },
    });
  });

  it("includes details on ValidationError", async () => {
    const handler = apiHandler(async () => {
      throw new ValidationError("Bad input", { field: "name" });
    });
    const res = await handler(makeRequest());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: "validation_failed",
        message: "Bad input",
        details: { field: "name" },
      },
    });
  });

  it("converts unknown errors to 500 internal", async () => {
    const handler = apiHandler(async () => {
      throw new Error("kaboom");
    });
    const res = await handler(makeRequest());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "internal", message: "Internal server error" },
    });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
pnpm test:unit tests/unit/api-handler.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/auth/api-handler'".

- [ ] **Step 3: Implement apiHandler**

Create `src/lib/auth/api-handler.ts`:

```ts
import { ApiError } from "./errors";

type Handler<Ctx> = (req: Request, ctx: Ctx) => Promise<unknown> | unknown;

export function apiHandler<Ctx = undefined>(handler: Handler<Ctx>) {
  return async (req: Request, ctx?: Ctx): Promise<Response> => {
    try {
      const result = await handler(req, ctx as Ctx);
      if (result === undefined || result === null) {
        return new Response(null, { status: 204 });
      }
      return Response.json(result);
    } catch (err) {
      if (err instanceof ApiError) {
        return Response.json(
          {
            error: {
              code: err.code,
              message: err.message,
              ...(err.details !== undefined ? { details: err.details } : {}),
            },
          },
          { status: err.status },
        );
      }
      console.error("Unhandled API error:", err);
      return Response.json(
        { error: { code: "internal", message: "Internal server error" } },
        { status: 500 },
      );
    }
  };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
pnpm test:unit tests/unit/api-handler.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/api-handler.test.ts src/lib/auth/api-handler.ts
git commit -m "feat(api): add apiHandler wrapper with error envelope"
```

---

## Task 12: Build withFamily helper (TDD)

**Files:**
- Create: `tests/helpers/db.ts`, `tests/helpers/auth.ts`, `tests/unit/with-family.test.ts`, `src/lib/auth/with-family.ts`

- [ ] **Step 1: Create a test DB reset helper**

Create `tests/helpers/db.ts`:

```ts
import { db } from "@/lib/db/client";
import { profiles, familyUsers, users, families } from "@/lib/db/schema";

export async function resetDb() {
  await db.delete(profiles);
  await db.delete(familyUsers);
  await db.delete(users);
  await db.delete(families);
}
```

- [ ] **Step 2: Create a Clerk auth mock helper**

Create `tests/helpers/auth.ts`:

```ts
import { vi } from "vitest";

type ClerkAuthResult = { userId: string | null };

let currentClerkUserId: string | null = null;

export function setMockClerkUser(clerkUserId: string | null) {
  currentClerkUserId = clerkUserId;
}

vi.mock("@clerk/nextjs/server", () => ({
  auth: async (): Promise<ClerkAuthResult> => ({ userId: currentClerkUserId }),
}));
```

- [ ] **Step 3: Write the failing test for withFamily**

Create `tests/unit/with-family.test.ts`:

```ts
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import "../helpers/auth";
import { setMockClerkUser } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { db } from "@/lib/db/client";
import { families, users, familyUsers } from "@/lib/db/schema";
import { withFamily } from "@/lib/auth/with-family";
import { UnauthorizedError, ForbiddenError } from "@/lib/auth/errors";

beforeEach(async () => {
  await resetDb();
  setMockClerkUser(null);
});

describe("withFamily", () => {
  it("throws UnauthorizedError when no Clerk session", async () => {
    setMockClerkUser(null);
    await expect(withFamily()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("throws UnauthorizedError when Clerk user has no row in users table", async () => {
    setMockClerkUser("user_unknown");
    await expect(withFamily()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("throws ForbiddenError when user has no family membership", async () => {
    const [user] = await db
      .insert(users)
      .values({ clerkUserId: "user_no_family", email: "x@y.com" })
      .returning();
    setMockClerkUser("user_no_family");
    await expect(withFamily()).rejects.toBeInstanceOf(ForbiddenError);
    expect(user).toBeDefined();
  });

  it("returns userId and familyId for a member", async () => {
    const [family] = await db.insert(families).values({ name: "Test Family" }).returning();
    const [user] = await db
      .insert(users)
      .values({ clerkUserId: "user_member", email: "m@y.com" })
      .returning();
    await db.insert(familyUsers).values({ familyId: family!.id, userId: user!.id });

    setMockClerkUser("user_member");
    const ctx = await withFamily();
    expect(ctx.userId).toBe(user!.id);
    expect(ctx.familyId).toBe(family!.id);
  });
});
```

- [ ] **Step 4: Run the test to confirm it fails**

```bash
pnpm test:unit tests/unit/with-family.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/auth/with-family'".

- [ ] **Step 5: Implement withFamily**

Create `src/lib/auth/with-family.ts`:

```ts
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, familyUsers } from "@/lib/db/schema";
import { UnauthorizedError, ForbiddenError } from "./errors";

export interface FamilyContext {
  userId: string;
  familyId: string;
  clerkUserId: string;
}

export async function withFamily(): Promise<FamilyContext> {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) throw new UnauthorizedError();

  const user = await db.query.users.findFirst({
    where: eq(users.clerkUserId, clerkUserId),
  });
  if (!user) throw new UnauthorizedError("No internal user record for Clerk session");

  const membership = await db.query.familyUsers.findFirst({
    where: eq(familyUsers.userId, user.id),
  });
  if (!membership) throw new ForbiddenError("User has no family membership");

  return { userId: user.id, familyId: membership.familyId, clerkUserId };
}
```

- [ ] **Step 6: Run the test to confirm it passes**

```bash
pnpm test:unit tests/unit/with-family.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(auth): add withFamily helper with TDD coverage"
```

---

## Task 13: Document the data-access convention

**Files:**
- Create: `docs/conventions/data-access.md`

- [ ] **Step 1: Write the convention doc**

Create `docs/conventions/data-access.md`:

```markdown
# Data Access Convention

## Rule

Every database query against a domain table MUST be scoped by `family_id`.
There is no exception in v1.

## How to comply

In API routes:

\`\`\`ts
import { apiHandler } from "@/lib/auth/api-handler";
import { withFamily } from "@/lib/auth/with-family";
import { db } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const GET = apiHandler(async () => {
  const { familyId } = await withFamily();
  const items = await db
    .select()
    .from(profiles)
    .where(eq(profiles.familyId, familyId));
  return { items };
});
\`\`\`

In Server Components:

\`\`\`tsx
import { withFamily } from "@/lib/auth/with-family";
// same pattern: resolve familyId first, scope every query.
\`\`\`

## Identity tables (exempt — they ARE the scoping mechanism)

- \`users\` — keyed by \`clerk_user_id\`
- \`families\` — keyed by \`id\`
- \`family_users\` — the join row used to derive \`familyId\`

Everything else is a domain table and MUST filter by \`family_id\`.

## Why no Postgres RLS in v1

Application-layer enforcement is simpler to read, audit, and test. RLS is a
non-breaking add later (set \`app.current_family_id\` per-request and apply
\`USING\` policies). When we add a second customer, we'll evaluate.

## Future enforcement options

- A custom Drizzle helper \`scopedDb(familyId)\` that pre-applies the filter.
- An ESLint rule that flags raw \`db.select().from(<domain table>)\` calls
  without a \`.where(eq(<domain table>.familyId, ...))\`.

Both deferred to a later phase.
```

- [ ] **Step 2: Commit**

```bash
git add docs/conventions/data-access.md
git commit -m "docs: document family_id scoping convention"
```

---

## Task 14: Build the seed script

**Files:**
- Create: `scripts/seed-family.ts`, `scripts/seed-config.example.json`

- [ ] **Step 1: Document the seed config shape**

Create `scripts/seed-config.example.json`:

```json
{
  "family": {
    "name": "The McKinney Family",
    "timezone": "America/New_York",
    "weekStartsOn": 0
  },
  "users": [
    { "clerkUserId": "user_xxxxxxxxxxxxxxxxxxxxxx", "email": "jacob@example.com", "displayName": "Jacob" }
  ],
  "profiles": [
    { "displayName": "Jacob", "color": "#3b82f6", "linkUserClerkId": "user_xxxxxxxxxxxxxxxxxxxxxx" },
    { "displayName": "Spouse", "color": "#a855f7" },
    { "displayName": "Kid 1", "color": "#22c55e" }
  ]
}
```

- [ ] **Step 2: Write the seed script**

Create `scripts/seed-family.ts`:

```ts
#!/usr/bin/env tsx
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
```

- [ ] **Step 3: Add a seed script to package.json**

In `package.json` `scripts`:

```json
{
  "scripts": {
    "db:seed": "tsx scripts/seed-family.ts"
  }
}
```

- [ ] **Step 4: Manually verify against dev DB**

Create a real config from `scripts/seed-config.example.json` (use your real Clerk user ID from the test sign-up in Task 6). Save as `scripts/seed-config.local.json` (gitignore it):

```bash
echo "scripts/seed-config.local.json" >> .gitignore
cp scripts/seed-config.example.json scripts/seed-config.local.json
# edit scripts/seed-config.local.json — fill in your real Clerk user ID
pnpm db:seed scripts/seed-config.local.json
```

Expected: `✅ Seeded family ...` log line.

Verify in DB:

```bash
docker exec mealplan-postgres psql -U postgres -d mealplan -c "SELECT name FROM families; SELECT display_name FROM profiles;"
```

Expected: your family + profiles listed.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-family.ts scripts/seed-config.example.json package.json .gitignore
git commit -m "feat(seed): add family seed script with json config"
```

---

## Task 15: Implement GET /api/me (with integration test)

**Files:**
- Create: `src/lib/api/me.ts` (response type), `src/app/api/me/route.ts`, `tests/integration/api-me.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/api-me.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import "../helpers/auth";
import { setMockClerkUser } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { db } from "@/lib/db/client";
import { families, users, familyUsers, profiles } from "@/lib/db/schema";
import { GET } from "@/app/api/me/route";

beforeEach(async () => {
  await resetDb();
  setMockClerkUser(null);
});

function makeRequest() {
  return new Request("http://localhost/api/me");
}

describe("GET /api/me", () => {
  it("returns 401 when no session", async () => {
    setMockClerkUser(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns user, family, and profiles for an authenticated member", async () => {
    const [family] = await db
      .insert(families)
      .values({ name: "Test Family" })
      .returning();
    const [user] = await db
      .insert(users)
      .values({ clerkUserId: "user_me_test", email: "me@test.com", displayName: "Me" })
      .returning();
    await db.insert(familyUsers).values({ familyId: family!.id, userId: user!.id });
    await db.insert(profiles).values([
      { familyId: family!.id, displayName: "Me", color: "#ff0000", sortOrder: 0 },
      { familyId: family!.id, displayName: "Spouse", color: "#00ff00", sortOrder: 1 },
    ]);

    setMockClerkUser("user_me_test");
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.id).toBe(user!.id);
    expect(body.family.id).toBe(family!.id);
    expect(body.profiles).toHaveLength(2);
    expect(body.profiles[0].displayName).toBe("Me");
    expect(body.profiles[1].displayName).toBe("Spouse");
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
pnpm test:integration tests/integration/api-me.test.ts
```

Expected: FAIL with "Cannot find module '@/app/api/me/route'".

- [ ] **Step 3: Implement the route**

Create `src/app/api/me/route.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
pnpm test:integration tests/integration/api-me.test.ts
```

Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/api-me.test.ts src/app/api/me/route.ts
git commit -m "feat(api): add GET /api/me smoke route"
```

---

## Task 16: Build profile validation schemas + API routes (TDD)

**Files:**
- Create: `src/lib/validation/profile.ts`, `src/app/api/profiles/route.ts`, `src/app/api/profiles/[id]/route.ts`, `tests/integration/api-profiles.test.ts`

- [ ] **Step 1: Define Zod schemas**

Create `src/lib/validation/profile.ts`:

```ts
import { z } from "zod";

export const ProfileCreateSchema = z.object({
  displayName: z.string().min(1).max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sortOrder: z.number().int().min(0).max(99).optional(),
  userId: z.string().uuid().nullable().optional(),
});

export const ProfileUpdateSchema = ProfileCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type ProfileCreate = z.infer<typeof ProfileCreateSchema>;
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;
```

- [ ] **Step 2: Write the failing integration test**

Create `tests/integration/api-profiles.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import "../helpers/auth";
import { setMockClerkUser } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { db } from "@/lib/db/client";
import { families, users, familyUsers, profiles } from "@/lib/db/schema";
import { GET as listGET, POST as listPOST } from "@/app/api/profiles/route";
import { PATCH as itemPATCH, DELETE as itemDELETE } from "@/app/api/profiles/[id]/route";

let familyId: string;
let userId: string;

async function seed() {
  const [f] = await db.insert(families).values({ name: "T" }).returning();
  const [u] = await db.insert(users).values({ clerkUserId: "user_p", email: "p@x.com" }).returning();
  await db.insert(familyUsers).values({ familyId: f!.id, userId: u!.id });
  familyId = f!.id;
  userId = u!.id;
  setMockClerkUser("user_p");
}

beforeEach(async () => {
  await resetDb();
  await seed();
});

describe("GET /api/profiles", () => {
  it("returns family-scoped profiles only", async () => {
    const [otherFamily] = await db.insert(families).values({ name: "Other" }).returning();
    await db.insert(profiles).values([
      { familyId, displayName: "Mine A", color: "#111111", sortOrder: 0 },
      { familyId, displayName: "Mine B", color: "#222222", sortOrder: 1 },
      { familyId: otherFamily!.id, displayName: "Theirs", color: "#333333", sortOrder: 0 },
    ]);
    const res = await listGET(new Request("http://localhost/api/profiles"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.items.map((p: { displayName: string }) => p.displayName).sort()).toEqual(["Mine A", "Mine B"]);
  });
});

describe("POST /api/profiles", () => {
  it("creates a profile in the caller's family", async () => {
    const req = new Request("http://localhost/api/profiles", {
      method: "POST",
      body: JSON.stringify({ displayName: "New", color: "#abcdef" }),
      headers: { "content-type": "application/json" },
    });
    const res = await listPOST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.familyId).toBe(familyId);
    expect(body.displayName).toBe("New");
    expect(body.createdByUserId).toBe(userId);
  });

  it("returns 400 on invalid color", async () => {
    const req = new Request("http://localhost/api/profiles", {
      method: "POST",
      body: JSON.stringify({ displayName: "X", color: "not-a-color" }),
      headers: { "content-type": "application/json" },
    });
    const res = await listPOST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
  });
});

describe("PATCH /api/profiles/[id]", () => {
  it("updates only the caller's family's profile", async () => {
    const [own] = await db
      .insert(profiles)
      .values({ familyId, displayName: "Old", color: "#111111", sortOrder: 0 })
      .returning();
    const req = new Request(`http://localhost/api/profiles/${own!.id}`, {
      method: "PATCH",
      body: JSON.stringify({ displayName: "New" }),
      headers: { "content-type": "application/json" },
    });
    const res = await itemPATCH(req, { params: Promise.resolve({ id: own!.id }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.displayName).toBe("New");
    expect(body.updatedByUserId).toBe(userId);
  });

  it("returns 404 when targeting another family's profile", async () => {
    const [otherFamily] = await db.insert(families).values({ name: "Other" }).returning();
    const [theirs] = await db
      .insert(profiles)
      .values({ familyId: otherFamily!.id, displayName: "Theirs", color: "#333333", sortOrder: 0 })
      .returning();
    const req = new Request(`http://localhost/api/profiles/${theirs!.id}`, {
      method: "PATCH",
      body: JSON.stringify({ displayName: "Hacked" }),
      headers: { "content-type": "application/json" },
    });
    const res = await itemPATCH(req, { params: Promise.resolve({ id: theirs!.id }) });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/profiles/[id]", () => {
  it("archives by setting is_active=false", async () => {
    const [own] = await db
      .insert(profiles)
      .values({ familyId, displayName: "Bye", color: "#111111", sortOrder: 0 })
      .returning();
    const req = new Request(`http://localhost/api/profiles/${own!.id}`, { method: "DELETE" });
    const res = await itemDELETE(req, { params: Promise.resolve({ id: own!.id }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isActive).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

```bash
pnpm test:integration tests/integration/api-profiles.test.ts
```

Expected: FAIL with "Cannot find module" errors.

- [ ] **Step 4: Implement the list/create route**

Create `src/app/api/profiles/route.ts`:

```ts
import { and, eq, asc } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { withFamily } from "@/lib/auth/with-family";
import { db } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
import { ProfileCreateSchema } from "@/lib/validation/profile";
import { ValidationError } from "@/lib/auth/errors";

export const GET = apiHandler(async () => {
  const { familyId } = await withFamily();
  const items = await db
    .select()
    .from(profiles)
    .where(eq(profiles.familyId, familyId))
    .orderBy(asc(profiles.sortOrder), asc(profiles.createdAt));
  return { items };
});

export const POST = apiHandler(async (req) => {
  const { familyId, userId } = await withFamily();
  const json = await req.json();
  const parsed = ProfileCreateSchema.safeParse(json);
  if (!parsed.success) {
    throw new ValidationError("Invalid profile payload", parsed.error.flatten());
  }

  const [created] = await db
    .insert(profiles)
    .values({
      familyId,
      displayName: parsed.data.displayName,
      color: parsed.data.color,
      sortOrder: parsed.data.sortOrder ?? 0,
      userId: parsed.data.userId ?? null,
      createdByUserId: userId,
      updatedByUserId: userId,
    })
    .returning();
  return created;
});
```

- [ ] **Step 5: Implement the item route**

Create `src/app/api/profiles/[id]/route.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { withFamily } from "@/lib/auth/with-family";
import { db } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
import { ProfileUpdateSchema } from "@/lib/validation/profile";
import { NotFoundError, ValidationError } from "@/lib/auth/errors";

type RouteCtx = { params: Promise<{ id: string }> };

export const PATCH = apiHandler<RouteCtx>(async (req, ctx) => {
  const { familyId, userId } = await withFamily();
  const { id } = await ctx.params;

  const json = await req.json();
  const parsed = ProfileUpdateSchema.safeParse(json);
  if (!parsed.success) {
    throw new ValidationError("Invalid profile payload", parsed.error.flatten());
  }

  const [updated] = await db
    .update(profiles)
    .set({
      ...parsed.data,
      updatedByUserId: userId,
      updatedAt: new Date(),
    })
    .where(and(eq(profiles.id, id), eq(profiles.familyId, familyId)))
    .returning();

  if (!updated) throw new NotFoundError("Profile not found");
  return updated;
});

export const DELETE = apiHandler<RouteCtx>(async (_req, ctx) => {
  const { familyId, userId } = await withFamily();
  const { id } = await ctx.params;

  const [updated] = await db
    .update(profiles)
    .set({ isActive: false, updatedByUserId: userId, updatedAt: new Date() })
    .where(and(eq(profiles.id, id), eq(profiles.familyId, familyId)))
    .returning();

  if (!updated) throw new NotFoundError("Profile not found");
  return updated;
});
```

- [ ] **Step 6: Run the test to confirm it passes**

```bash
pnpm test:integration tests/integration/api-profiles.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(api): add profiles CRUD with validation and tenant scoping"
```

---

## Task 17: Build the profiles management UI

**Files:**
- Create: `src/lib/http/fetcher.ts`, `src/components/profile-list.tsx`, `src/components/profile-form.tsx`, `src/app/app/settings/profiles/page.tsx`

- [ ] **Step 1: Write a thin client fetcher**

Create `src/lib/http/fetcher.ts`:

```ts
export type ApiErrorBody = {
  error: { code: string; message: string; details?: unknown };
};

export class ClientApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
    this.name = "ClientApiError";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body as ApiErrorBody | null;
    throw new ClientApiError(
      err?.error.code ?? "internal",
      err?.error.message ?? `Request failed: ${res.status}`,
      err?.error.details,
    );
  }
  return body as T;
}
```

- [ ] **Step 2: Build the profile form**

Create `src/components/profile-form.tsx`:

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ClientApiError } from "@/lib/http/fetcher";

export interface ProfileFormProps {
  initial?: { id?: string; displayName: string; color: string };
  onSaved: () => void;
  onCancel?: () => void;
}

export function ProfileForm({ initial, onSaved, onCancel }: ProfileFormProps) {
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [color, setColor] = useState(initial?.color ?? "#94a3b8");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (initial?.id) {
        await api(`/api/profiles/${initial.id}`, {
          method: "PATCH",
          body: JSON.stringify({ displayName, color }),
        });
      } else {
        await api("/api/profiles", {
          method: "POST",
          body: JSON.stringify({ displayName, color }),
        });
      }
      onSaved();
    } catch (err) {
      if (err instanceof ClientApiError) setError(err.message);
      else setError("Unexpected error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="displayName">Name</Label>
        <Input
          id="displayName"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          maxLength={80}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="color">Color</Label>
        <Input
          id="color"
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-10 w-20 p-1"
        />
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {initial?.id ? "Save" : "Create profile"}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Build the profile list (client component)**

Create `src/components/profile-list.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProfileForm } from "./profile-form";
import { api } from "@/lib/http/fetcher";

export interface ProfileItem {
  id: string;
  displayName: string;
  color: string;
  isActive: boolean;
}

export function ProfileList({ initialItems }: { initialItems: ProfileItem[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function refresh() {
    setCreating(false);
    setEditingId(null);
    startTransition(() => router.refresh());
  }

  async function archive(id: string) {
    if (!confirm("Archive this profile?")) return;
    await api(`/api/profiles/${id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Profiles</h2>
        {!creating ? (
          <Button onClick={() => setCreating(true)}>Add profile</Button>
        ) : null}
      </div>

      {creating ? (
        <Card className="p-4">
          <ProfileForm onSaved={refresh} onCancel={() => setCreating(false)} />
        </Card>
      ) : null}

      <ul className="flex flex-col gap-2">
        {initialItems.map((p) => (
          <li key={p.id}>
            <Card className="flex items-center gap-3 p-3">
              <span
                className="h-6 w-6 shrink-0 rounded-full"
                style={{ backgroundColor: p.color }}
                aria-hidden
              />
              {editingId === p.id ? (
                <div className="flex-1">
                  <ProfileForm
                    initial={p}
                    onSaved={refresh}
                    onCancel={() => setEditingId(null)}
                  />
                </div>
              ) : (
                <>
                  <div className="flex-1">
                    <div className="font-medium">{p.displayName}</div>
                    {!p.isActive ? (
                      <div className="text-xs text-muted-foreground">Archived</div>
                    ) : null}
                  </div>
                  <Button variant="ghost" onClick={() => setEditingId(p.id)}>
                    Edit
                  </Button>
                  {p.isActive ? (
                    <Button variant="ghost" onClick={() => archive(p.id)} disabled={pending}>
                      Archive
                    </Button>
                  ) : null}
                </>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Build the page (server component fetching initial data)**

Create `src/app/app/settings/profiles/page.tsx`:

```tsx
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
```

- [ ] **Step 5: Verify in the browser**

```bash
pnpm dev
```

Sign in with the seeded user. Navigate to `/app/settings/profiles`. Expected:
- Seeded profiles render with their colors.
- "Add profile" creates a new one and the list refreshes.
- "Edit" inline-edits and saves.
- "Archive" sets `isActive=false`; the row shows "Archived" but stays.

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ui): add profile management page"
```

---

## Task 18: Configure PWA (next-pwa, manifest, icons)

**Files:**
- Create: `public/manifest.webmanifest`, `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png`, `src/components/install-prompt.tsx`
- Modify: `next.config.ts`, `src/app/layout.tsx`

- [ ] **Step 1: Install next-pwa fork compatible with App Router**

```bash
pnpm add @ducanh2912/next-pwa
```

- [ ] **Step 2: Wrap next.config**

Replace `next.config.ts`:

```ts
import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const isDev = process.env.NODE_ENV === "development";

const withPWA = withPWAInit({
  dest: "public",
  disable: isDev,
  register: true,
  workboxOptions: {
    runtimeCaching: [
      {
        urlPattern: /^\/api\/(me|profiles|grocery-list|week|meals).*/,
        handler: "StaleWhileRevalidate",
        options: { cacheName: "api-read", expiration: { maxAgeSeconds: 60 * 60 * 24 } },
      },
      {
        urlPattern: /\.(?:png|jpg|jpeg|svg|webp|ico)$/,
        handler: "CacheFirst",
        options: { cacheName: "images", expiration: { maxAgeSeconds: 60 * 60 * 24 * 30 } },
      },
    ],
  },
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: { typedRoutes: true },
};

export default withPWA(nextConfig);
```

- [ ] **Step 3: Create the manifest**

Create `public/manifest.webmanifest`:

```json
{
  "name": "Meal Plan",
  "short_name": "Meal Plan",
  "description": "Family meal planning, made simple.",
  "start_url": "/app",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#0f172a",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" },
    { "src": "/apple-touch-icon.png", "sizes": "180x180", "type": "image/png" }
  ]
}
```

- [ ] **Step 4: Generate placeholder icons**

If you have a logo, drop it in. Otherwise generate three solid-color squares:

```bash
pnpm dlx @squoosh/cli --resize '{"width":192,"height":192}' --quant '{"numColors":2}' icon.png || true
```

Or just create three solid PNGs of the right sizes manually. **For now**, create three 1x1 transparent PNGs as a placeholder so the build doesn't fail — replace with real assets before production:

```bash
# Quick placeholder: use ImageMagick if installed, else any 192/512 PNG works.
convert -size 192x192 xc:'#0f172a' public/icon-192.png || \
  echo "Replace public/icon-192.png with a real icon before production."
convert -size 512x512 xc:'#0f172a' public/icon-512.png || true
convert -size 180x180 xc:'#0f172a' public/apple-touch-icon.png || true
```

If `convert` isn't installed, manually drop any 192x192, 512x512, and 180x180 PNG into `public/`.

- [ ] **Step 5: Link the manifest from `<head>`**

Update `src/app/layout.tsx` metadata:

```tsx
import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "Meal Plan",
  description: "Family meal planning",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
```

- [ ] **Step 6: Add an install-prompt component**

Create `src/components/install-prompt.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPrompt() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!evt) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md border bg-background p-3 shadow-md">
      <div className="mb-2 text-sm">Install Meal Plan on your home screen?</div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={async () => {
            await evt.prompt();
            await evt.userChoice;
            setEvt(null);
          }}
        >
          Install
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEvt(null)}>
          Not now
        </Button>
      </div>
    </div>
  );
}
```

Mount it in the protected layout. Replace the contents of `src/app/app/layout.tsx` with:

```tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { InstallPrompt } from "@/components/install-prompt";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <Link href="/app" className="font-semibold">Meal Plan</Link>
        <nav className="flex items-center gap-4">
          <Link href="/app/settings/profiles" className="text-sm">Profiles</Link>
          <UserButton afterSignOutUrl="/" />
        </nav>
      </header>
      <main className="px-4 py-6">{children}</main>
      <InstallPrompt />
    </div>
  );
}
```

- [ ] **Step 7: Verify build produces a service worker**

```bash
pnpm build
```

Expected: build succeeds; `public/sw.js` and `public/workbox-*.js` exist.

- [ ] **Step 8: Manual smoke**

```bash
pnpm start
```

Open `http://localhost:3000/app` in Chrome. Open DevTools → Application → Manifest. Expected: manifest parses without warnings, icons render. Service worker registers under Application → Service Workers. Stop the server.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(pwa): add manifest, icons, service worker, install prompt"
```

---

## Task 19: Install Sentry

**Files:**
- Create: `src/instrumentation.ts`, `src/instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`
- Modify: `next.config.ts`, `package.json`

- [ ] **Step 1: Run the Sentry wizard**

```bash
pnpm dlx @sentry/wizard@latest -i nextjs --skip-connect
```

When prompted: choose Next.js, App Router, accept the defaults. The wizard will create `sentry.*.config.ts` files, write `instrumentation.ts`, and modify `next.config.ts` to wrap with `withSentryConfig`.

- [ ] **Step 2: Reconcile next.config wrap order**

`next-pwa` and `@sentry/nextjs` both wrap `nextConfig`. Combine like this in `next.config.ts`:

```ts
import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";
import { withSentryConfig } from "@sentry/nextjs";

const isDev = process.env.NODE_ENV === "development";

const withPWA = withPWAInit({
  dest: "public",
  disable: isDev,
  register: true,
  workboxOptions: {
    runtimeCaching: [
      {
        urlPattern: /^\/api\/(me|profiles|grocery-list|week|meals).*/,
        handler: "StaleWhileRevalidate",
        options: { cacheName: "api-read", expiration: { maxAgeSeconds: 60 * 60 * 24 } },
      },
      {
        urlPattern: /\.(?:png|jpg|jpeg|svg|webp|ico)$/,
        handler: "CacheFirst",
        options: { cacheName: "images", expiration: { maxAgeSeconds: 60 * 60 * 24 * 30 } },
      },
    ],
  },
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: { typedRoutes: true },
};

export default withSentryConfig(withPWA(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  hideSourceMaps: true,
  disableLogger: true,
});
```

- [ ] **Step 3: Confirm SENTRY_DSN is in env**

Add `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT` to `.env.local` from your Sentry project settings.

- [ ] **Step 4: Verify build still passes**

```bash
pnpm build
```

Expected: clean build. If Sentry warns about missing DSN at build time, that's OK in dev — production deploy will have it set in Vercel.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: install sentry for client + server error tracking"
```

---

## Task 20: Install Vercel Analytics

**Files:**
- Modify: `src/app/layout.tsx`, `package.json`

- [ ] **Step 1: Install**

```bash
pnpm add @vercel/analytics @vercel/speed-insights
```

- [ ] **Step 2: Mount in root layout**

Update `src/app/layout.tsx`:

```tsx
import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Meal Plan",
  description: "Family meal planning",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          {children}
          <Analytics />
          <SpeedInsights />
        </body>
      </html>
    </ClerkProvider>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: add vercel analytics + speed insights"
```

---

## Task 21: Set up Playwright + write smoke E2E

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/smoke.spec.ts`

- [ ] **Step 1: Install Playwright**

```bash
pnpm add -D @playwright/test
pnpm exec playwright install --with-deps chromium
```

- [ ] **Step 2: Configure Playwright**

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-iphone", use: { ...devices["iPhone 14"] } },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "pnpm dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
```

- [ ] **Step 3: Add e2e script to package.json**

In `package.json` `scripts`:

```json
{
  "scripts": {
    "test:e2e": "playwright test"
  }
}
```

- [ ] **Step 4: Write the smoke test**

Create `tests/e2e/smoke.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

const E2E_USER_EMAIL = process.env.E2E_USER_EMAIL;
const E2E_USER_PASSWORD = process.env.E2E_USER_PASSWORD;

test.describe("foundation smoke", () => {
  test("landing page renders without auth", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Meal Plan" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  test("manifest is served", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.name).toBe("Meal Plan");
    expect(json.start_url).toBe("/app");
  });

  test.skip(
    !E2E_USER_EMAIL || !E2E_USER_PASSWORD,
    "Authenticated flow requires E2E_USER_EMAIL + E2E_USER_PASSWORD",
  );

  test("authenticated user can view profiles page", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel(/email/i).fill(E2E_USER_EMAIL!);
    await page.getByRole("button", { name: /continue/i }).click();
    await page.getByLabel(/password/i).fill(E2E_USER_PASSWORD!);
    await page.getByRole("button", { name: /continue|sign in/i }).click();
    await page.waitForURL("**/app");

    await page.goto("/app/settings/profiles");
    await expect(page.getByRole("heading", { name: "Profiles" })).toBeVisible();
  });
});
```

- [ ] **Step 5: Run the smoke test**

```bash
pnpm test:e2e
```

Expected: the two unauthenticated tests pass; the authenticated test skips unless you set `E2E_USER_EMAIL` and `E2E_USER_PASSWORD`. To run the authenticated test locally, export those env vars pointing to the test user you created in Task 6.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test(e2e): add foundation smoke playwright suite"
```

---

## Task 22: Add CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the CI config**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: mealplan_test
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    env:
      DATABASE_URL: postgres://postgres:postgres@localhost:5432/mealplan_test
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pk_test_dummy
      CLERK_SECRET_KEY: sk_test_dummy
      NEXT_PUBLIC_APP_URL: http://localhost:3000
      NODE_ENV: test

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm db:migrate
      - run: pnpm test
      - run: pnpm build
```

- [ ] **Step 2: Push branch and verify CI runs (after first push to GitHub)**

This step requires the repo to exist on GitHub. If not yet created:

```bash
gh repo create meal-plan-app --private --source=. --remote=origin --push
```

Otherwise:

```bash
git push -u origin main
```

Open the Actions tab on GitHub. Expected: workflow runs, all jobs green.

- [ ] **Step 3: Commit (if not yet committed by the steps above)**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add github actions workflow for typecheck + tests + build"
git push
```

---

## Task 23: Connect Vercel and provision Neon

**Files:**
- None in repo (Vercel and Neon UI work).

- [ ] **Step 1: Link the project to Vercel**

```bash
pnpm dlx vercel@latest link
```

Choose "Link to existing project" only if you've already created one; otherwise create a new project.

- [ ] **Step 2: Provision Neon via Vercel Marketplace**

In the Vercel dashboard for the project:
- Storage tab → Browse Marketplace → Neon → Add to project.
- Accept the defaults; Neon will create a database and inject `DATABASE_URL` into all environments (Preview + Production).

- [ ] **Step 3: Add Clerk env vars to Vercel**

For Production AND Preview, in Vercel → Settings → Environment Variables, add:

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY  (production keys for prod, dev keys for preview)
CLERK_SECRET_KEY
NEXT_PUBLIC_APP_URL                 (e.g., https://meal-plan.vercel.app for prod)
SENTRY_DSN
SENTRY_ORG
SENTRY_PROJECT
```

Also ensure Clerk's allowed redirect URLs include the Vercel preview pattern (`https://*.vercel.app`) and your prod domain.

- [ ] **Step 4: Pull env vars locally**

```bash
pnpm dlx vercel@latest env pull .env.local
```

This overwrites `.env.local` with the latest env vars from Vercel. Re-add any local-only values (e.g. local `DATABASE_URL` for Docker Postgres) — or use a separate `.env.development.local` for that.

**[ASSUMPTION]** for local dev we keep using the Docker Postgres `DATABASE_URL`. Don't pull that one from Vercel — exclude it manually after `vercel env pull`.

- [ ] **Step 5: Run migrations against the Neon preview branch**

For the first deploy:

```bash
DATABASE_URL="<paste Neon preview URL from Vercel>" pnpm db:migrate
```

(Neon preview branches are auto-created per deployment; for the initial setup, target the default branch.)

- [ ] **Step 6: Trigger a preview deployment**

```bash
git push
```

Open the Vercel deployment URL. Expected: landing page renders, Clerk sign-up works, no runtime errors in Vercel Logs.

- [ ] **Step 7: Seed the production family**

For the production env:

```bash
DATABASE_URL="<paste Neon production URL from Vercel>" pnpm db:seed scripts/seed-config.local.json
```

- [ ] **Step 8: Promote to production and smoke-test**

In Vercel, promote the latest preview to production (or merge to `main` if production is wired to `main`). Visit the production URL. Expected: sign in with the seeded Clerk user → land at `/app` → see profiles list with seeded data.

- [ ] **Step 9: Commit any final config tweaks (no required code change)**

If `next.config.ts`, `.env.example`, or other configs needed adjustment during deploy, commit them now:

```bash
git add -A
git diff --cached --quiet || git commit -m "chore: deploy adjustments"
git push
```

---

## Task 24: Mobile install verification (manual exit-criteria smoke)

**Files:** none — this is a verification task.

- [ ] **Step 1: Install on iPhone Safari**

On an iPhone, open the Vercel production URL in Safari. Tap Share → Add to Home Screen. Confirm:
- App icon appears on home screen with the correct name "Meal Plan".
- Tapping the icon opens in standalone mode (no browser chrome).
- Sign in works inside the standalone app.

- [ ] **Step 2: Install on Android Chrome**

On an Android device, open the URL in Chrome. Tap the install banner (or menu → Install app). Confirm:
- App icon appears on home screen.
- Standalone launch works.
- Sign in works.

- [ ] **Step 3: Confirm exit criteria**

A seeded family member can:
- ✅ log in
- ✅ see their profiles
- ✅ add, edit, archive a profile
- ✅ install the PWA on iOS and Android

If any of the above fails, fix it and re-deploy before declaring Phase 0 complete.

- [ ] **Step 4: Tag the milestone**

```bash
git tag v0.1.0-foundation
git push --tags
```

---

## Phase 0 done

If every task above is checked, Phase 0 is complete. The project now has:

- Next.js 16 + TypeScript + Tailwind + shadcn
- Clerk auth with sign-in / sign-up / sign-out and a protected `/app` shell
- Neon Postgres in deployed envs, Docker Postgres locally and in CI
- Drizzle schema for `families`, `users`, `family_users`, `profiles` with audit columns
- `withFamily` helper enforcing tenant scoping; `apiHandler` wrapper providing the error envelope
- A documented data-access convention (`docs/conventions/data-access.md`)
- Profile CRUD API + UI
- A seed script for manual family + user assignment
- An installable PWA with stale-while-revalidate read caching
- Sentry, Vercel Analytics, Speed Insights
- Vitest unit + integration tests, Playwright E2E smoke
- A green CI workflow on every PR
- Working Vercel preview + production deploys

Next phase: write `docs/superpowers/specs/2026-XX-XX-phase-1-meal-inventory-design.md`, then plan it.
