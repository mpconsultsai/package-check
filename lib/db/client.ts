import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";

let client: ReturnType<typeof postgres> | null = null;
let database: PostgresJsDatabase<typeof schema> | null = null;

export type Database = PostgresJsDatabase<typeof schema>;

function projectRef(supabaseUrl: string): string | null {
  try {
    const host = new URL(supabaseUrl).hostname;
    const ref = host.split(".")[0];
    return ref || null;
  } catch {
    return null;
  }
}

type PostgresConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
};

function postgresConfig(): PostgresConfig | null {
  const password = process.env.POSTGRES_DB_PWD?.trim();
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  if (!password || !supabaseUrl) return null;
  const ref = projectRef(supabaseUrl);
  if (!ref) return null;

  const host = process.env.SUPABASE_DB_HOST?.trim() || `db.${ref}.supabase.co`;
  const portNumber = Number(process.env.SUPABASE_DB_PORT || "5432");
  const port = Number.isFinite(portNumber) ? portNumber : 5432;
  const username =
    process.env.SUPABASE_DB_USER?.trim() ||
    (host.includes("pooler.supabase.com") ? `postgres.${ref}` : "postgres");

  return { host, port, username, password };
}

/** Safe connection details for logs. Password material is omitted. */
export function databaseLogContext(): {
  configured: boolean;
  host: string;
  port: number;
  user: string;
} {
  const config = postgresConfig();
  return {
    configured: config !== null,
    host: config?.host ?? "",
    port: config?.port ?? 5432,
    user: config?.username ?? "",
  };
}

/** Server-side Postgres client. Null when the database env is unset. */
export function getSql(): ReturnType<typeof postgres> | null {
  if (client) return client;
  const config = postgresConfig();
  if (!config) return null;

  client = postgres({
    host: config.host,
    port: config.port,
    database: "postgres",
    username: config.username,
    password: config.password,
    ssl: "require",
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    // The transaction pooler does not keep prepared statements.
    prepare: !config.host.includes("pooler.supabase.com"),
  });
  return client;
}

/** Drizzle handle for the shared Postgres connection. Null when the database env is unset. */
export function getDb(): Database | null {
  const sql = getSql();
  if (!sql) return null;
  if (!database) database = drizzle(sql, { schema });
  return database;
}
