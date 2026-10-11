import { sql } from "drizzle-orm";
import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { PackageEcosystem } from "@/lib/package-routes";

export const PACKAGE_SEARCH_SOURCES = ["web", "mcp", "api"] as const;
export type PackageSearchSource = (typeof PACKAGE_SEARCH_SOURCES)[number];

/** Anonymous package searches. Mirrors public.package_searches in Supabase. */
export const packageSearches = pgTable("package_searches", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  ecosystem: text("ecosystem").$type<PackageEcosystem>().notNull(),
  query: text("query").notNull(),
  queryNormalized: text("query_normalized").generatedAlwaysAs(
    () => sql`lower(btrim(query))`,
  ),
  resultCount: integer("result_count").notNull().default(0),
  resultNames: text("result_names").array().notNull().default([]),
  source: text("source").$type<PackageSearchSource>().notNull().default("web"),
  metadata: jsonb("metadata").notNull().default({}),
});
