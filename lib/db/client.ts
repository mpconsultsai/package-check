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

/** Trim and drop wrapping quotes from dashboard/env copy-paste. */
export const envValue = (value: string | undefined): string => {
  const trimmed = value?.trim() ?? "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

/**
 * Prefer `POSTGRES_DB_PWD_B64` (base64 of the real password) so `$`, `#`,
 * quotes, and similar survive Render / .env paste. Falls back to plain
 * `POSTGRES_DB_PWD`.
 */
type EnvMap = Record<string, string | undefined>;

export const resolvePostgresPassword = (env: EnvMap = process.env): string => {
  const encoded = envValue(env.POSTGRES_DB_PWD_B64);
  if (encoded) {
    try {
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      // Reject obvious non-base64 garbage that decodes to empty or binary junk.
      if (decoded.length > 0) return decoded;
    } catch {
      // fall through
    }
  }
  return envValue(env.POSTGRES_DB_PWD);
};

type PostgresConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
};

function postgresConfig(env: EnvMap = process.env): PostgresConfig | null {
  const password = resolvePostgresPassword(env);
  const supabaseUrl = envValue(env.SUPABASE_URL);
  if (!password || !supabaseUrl) return null;
  const ref = projectRef(supabaseUrl);
  if (!ref) return null;

  const host = envValue(env.SUPABASE_DB_HOST) || `db.${ref}.supabase.co`;
  const pooler = host.includes("pooler.supabase.com");
  // Transaction pooler is 6543; direct db.* hosts use 5432.
  const defaultPort = pooler ? "6543" : "5432";
  const portNumber = Number(envValue(env.SUPABASE_DB_PORT) || defaultPort);
  const port = Number.isFinite(portNumber) ? portNumber : Number(defaultPort);
  const username =
    envValue(env.SUPABASE_DB_USER) ||
    (pooler ? `postgres.${ref}` : "postgres");

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
