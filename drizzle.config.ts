import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

loadEnv({ path: ".dev.vars" });

const url = process.env.DIRECT_DATABASE_URL;
if (!url) {
  throw new Error(
    "DIRECT_DATABASE_URL is required in .dev.vars (Supabase Direct connection, port 5432).",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  schemaFilter: ["public"],
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
