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

const blank = (v: string | undefined) => (v === "" ? undefined : v);

const processEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  CLERK_WEBHOOK_SECRET: blank(process.env.CLERK_WEBHOOK_SECRET),
  ANTHROPIC_API_KEY: blank(process.env.ANTHROPIC_API_KEY),
  BLOB_READ_WRITE_TOKEN: blank(process.env.BLOB_READ_WRITE_TOKEN),
  SENTRY_DSN: blank(process.env.SENTRY_DSN),
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
