import { createHash } from "node:crypto";

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_REQUEST_LIMIT = 60;
const DEFAULT_ANALYSE_LIMIT = 6;

/** Sliding-window counters keyed by bucket id (in-process; fine for one Render web service). */
const buckets = new Map<string, number[]>();

const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};

export const mcpRequestLimitPerMinute = (): number =>
  envInt("MCP_RATE_LIMIT_PER_MIN", DEFAULT_REQUEST_LIMIT);

export const mcpAnalyseLimitPerMinute = (): number =>
  envInt("MCP_ANALYSE_RATE_LIMIT_PER_MIN", DEFAULT_ANALYSE_LIMIT);

/** Stable, non-reversible id for the bearer token (never store the raw secret). */
export const mcpClientKey = (authorization: string | null): string => {
  const match = authorization?.match(/^Bearer\s+(\S+)\s*$/i);
  if (!match) return "anonymous";
  return createHash("sha256").update(match[1]).digest("hex").slice(0, 24);
};

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSec: number };

/**
 * Record one event against `bucketKey` within a sliding window.
 * Returns retryAfterSec when the limit is already full.
 */
export const takeRateLimit = (
  bucketKey: string,
  limit: number,
  windowMs = DEFAULT_WINDOW_MS,
  now = Date.now(),
): RateLimitResult => {
  const cutoff = now - windowMs;
  const recent = (buckets.get(bucketKey) ?? []).filter((time) => time > cutoff);
  if (recent.length >= limit) {
    const oldest = recent[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    buckets.set(bucketKey, recent);
    return { ok: false, retryAfterSec };
  }
  recent.push(now);
  buckets.set(bucketKey, recent);
  return { ok: true };
};

export const takeMcpRequestLimit = (
  clientKey: string,
  now = Date.now(),
): RateLimitResult =>
  takeRateLimit(
    `mcp:req:${clientKey}`,
    mcpRequestLimitPerMinute(),
    DEFAULT_WINDOW_MS,
    now,
  );

export const takeMcpAnalyseLimit = (
  clientKey: string,
  now = Date.now(),
): RateLimitResult =>
  takeRateLimit(
    `mcp:analyse:${clientKey}`,
    mcpAnalyseLimitPerMinute(),
    DEFAULT_WINDOW_MS,
    now,
  );

/** Test helper — clears in-memory counters. */
export const resetMcpRateLimits = (): void => {
  buckets.clear();
};
