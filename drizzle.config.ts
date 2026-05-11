import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: process.env.DATABASE_URL ? undefined : ".env.local" });

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
