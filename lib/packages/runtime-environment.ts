/**
 * Heuristic client / server / both classification from npm metadata.
 * Not authoritative - confidence varies by how clear the signals are.
 */

export type RuntimeKind = "client" | "server" | "both" | "unclear";

export type RuntimeConfidence = "high" | "medium" | "low";

export interface RuntimeEnvironment {
  kind: RuntimeKind;
  /** Short UI label */
  label: string;
  confidence: RuntimeConfidence;
  /** Why we inferred this (for tooltip / debugging) */
  reasons: string[];
}

export interface RuntimeClassificationInput {
  name?: string;
  description?: string;
  keywords?: string[];
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  /** package.json `browser` field */
  browser?: unknown;
  /** package.json `bin` */
  bin?: unknown;
  /** package.json `engines` */
  engines?: Record<string, string> | null;
  /** package.json `exports` */
  exports?: unknown;
  /** True when Bundlephobia returned a browser bundle size */
  hasBrowserBundle?: boolean;
}

const CLIENT_PEERS = [
  "react",
  "react-dom",
  "react-native",
  "vue",
  "@vue/runtime-dom",
  "@angular/core",
  "svelte",
  "solid-js",
  "preact",
  "lit",
  "next",
];

const CLIENT_DEPS = [
  "react-dom",
  "react-native",
  "@angular/common",
  "vue",
  "svelte",
  "solid-js",
  "preact",
];

const SERVER_DEPS = [
  "express",
  "fastify",
  "koa",
  "hapi",
  "@hapi/hapi",
  "@nestjs/core",
  "nestjs",
  "restify",
  "polka",
  "pg",
  "mysql",
  "mysql2",
  "mongodb",
  "mongoose",
  "ioredis",
  "redis",
  "bull",
  "bullmq",
  "sequelize",
  "typeorm",
  "prisma",
  "@prisma/client",
  "knex",
  "sqlite3",
  "better-sqlite3",
];

const CLIENT_KEYWORDS = new Set([
  "browser",
  "frontend",
  "front-end",
  "client",
  "client-side",
  "react",
  "vue",
  "angular",
  "svelte",
  "dom",
  "ui",
  "css",
  "webpack",
  "spa",
]);

const SERVER_KEYWORDS = new Set([
  "server",
  "backend",
  "back-end",
  "server-side",
  "nodejs",
  "node.js",
  "express",
  "cli",
  "command-line",
  "middleware",
  "api",
]);

const BOTH_KEYWORDS = new Set([
  "isomorphic",
  "universal",
  "isomorphic-javascript",
  "ssr",
]);

function depKeys(record?: Record<string, string>): string[] {
  return record ? Object.keys(record).map((k) => k.toLowerCase()) : [];
}

function hasAny(keys: string[], needles: string[]): string | null {
  const set = new Set(keys);
  for (const n of needles) {
    if (set.has(n.toLowerCase())) return n;
  }
  return null;
}

function keywordHits(keywords: string[] | undefined, set: Set<string>): string[] {
  if (!keywords?.length) return [];
  return keywords
    .map((k) => k.toLowerCase().trim())
    .filter((k) => set.has(k));
}

function exportsSuggestsBoth(exportsField: unknown): boolean {
  if (!exportsField || typeof exportsField !== "object") return false;
  const raw = JSON.stringify(exportsField).toLowerCase();
  const hasBrowser = raw.includes('"browser"');
  const hasNode = raw.includes('"node"') || raw.includes('"require"');
  return hasBrowser && hasNode;
}

function exportsSuggestsBrowser(exportsField: unknown): boolean {
  if (!exportsField || typeof exportsField !== "object") return false;
  return JSON.stringify(exportsField).toLowerCase().includes('"browser"');
}

function exportsSuggestsNodeOnly(exportsField: unknown): boolean {
  if (!exportsField || typeof exportsField !== "object") return false;
  const raw = JSON.stringify(exportsField).toLowerCase();
  const hasNode = raw.includes('"node"') || raw.includes('"require"');
  const hasBrowser = raw.includes('"browser"');
  return hasNode && !hasBrowser;
}

function hasBin(bin: unknown): boolean {
  if (!bin) return false;
  if (typeof bin === "string") return bin.length > 0;
  if (typeof bin === "object") return Object.keys(bin).length > 0;
  return false;
}

function hasBrowserField(browser: unknown): boolean {
  if (browser == null) return false;
  if (typeof browser === "string") return browser.length > 0;
  if (typeof browser === "boolean") return browser;
  if (typeof browser === "object") return Object.keys(browser as object).length > 0;
  return false;
}

function labelFor(kind: RuntimeKind): string {
  switch (kind) {
    case "client":
      return "Client";
    case "server":
      return "Server";
    case "both":
      return "Client & server";
    default:
      return "Unclear";
  }
}

/**
 * Infer whether a package targets the browser, Node/server, both, or is unclear.
 */
export function classifyRuntimeEnvironment(
  input: RuntimeClassificationInput,
): RuntimeEnvironment {
  let client = 0;
  let server = 0;
  const reasons: string[] = [];

  const peers = depKeys(input.peerDependencies);
  const deps = depKeys(input.dependencies);
  const allDeps = [...peers, ...deps];

  const clientPeer = hasAny(peers, CLIENT_PEERS);
  if (clientPeer) {
    client += 3;
    reasons.push(`peer dependency on ${clientPeer}`);
  }
  const clientDep = hasAny(deps, CLIENT_DEPS);
  if (clientDep && !clientPeer) {
    client += 2;
    reasons.push(`depends on ${clientDep}`);
  }

  const serverDep = hasAny(allDeps, SERVER_DEPS);
  if (serverDep) {
    server += 3;
    reasons.push(`depends on ${serverDep}`);
  }

  if (hasBrowserField(input.browser)) {
    client += 2;
    reasons.push("has package.json browser field");
  }

  if (exportsSuggestsBoth(input.exports)) {
    client += 2;
    server += 2;
    reasons.push("exports target both browser and node");
  } else if (exportsSuggestsBrowser(input.exports)) {
    client += 2;
    reasons.push("exports include browser condition");
  } else if (exportsSuggestsNodeOnly(input.exports)) {
    server += 1;
    reasons.push("exports look node-oriented");
  }

  if (hasBin(input.bin)) {
    server += 2;
    reasons.push("ships a CLI (bin)");
  }

  if (input.engines?.node && !hasBrowserField(input.browser) && !clientPeer) {
    server += 1;
    reasons.push("declares engines.node");
  }

  const bothKw = keywordHits(input.keywords, BOTH_KEYWORDS);
  if (bothKw.length) {
    client += 2;
    server += 2;
    reasons.push(`keywords: ${bothKw.slice(0, 2).join(", ")}`);
  }

  const clientKw = keywordHits(input.keywords, CLIENT_KEYWORDS);
  if (clientKw.length) {
    client += Math.min(2, clientKw.length);
    reasons.push(`client-oriented keywords (${clientKw.slice(0, 2).join(", ")})`);
  }

  const serverKw = keywordHits(input.keywords, SERVER_KEYWORDS);
  if (serverKw.length) {
    server += Math.min(2, serverKw.length);
    reasons.push(`server-oriented keywords (${serverKw.slice(0, 2).join(", ")})`);
  }

  const desc = (input.description || "").toLowerCase();
  if (/\b(browser|frontend|front-end|react component|dom)\b/.test(desc)) {
    client += 1;
    reasons.push("description mentions browser/UI");
  }
  if (/\b(server|backend|back-end|express|cli|command[- ]line)\b/.test(desc)) {
    server += 1;
    reasons.push("description mentions server/CLI");
  }
  if (/\b(isomorphic|universal|ssr)\b/.test(desc)) {
    client += 1;
    server += 1;
    reasons.push("description mentions isomorphic/universal use");
  }

  if (input.hasBrowserBundle === true) {
    client += 1;
    reasons.push("Bundlephobia can build a browser bundle");
  } else if (input.hasBrowserBundle === false && server >= 2 && client === 0) {
    server += 1;
    reasons.push("no browser bundle from Bundlephobia");
  }

  // Decide
  let kind: RuntimeKind;
  let confidence: RuntimeConfidence;

  const total = client + server;
  if (total === 0) {
    kind = "unclear";
    confidence = "low";
  } else if (client > 0 && server > 0 && Math.min(client, server) >= 2) {
    kind = "both";
    confidence =
      Math.min(client, server) >= 3 && total >= 6 ? "high" : "medium";
  } else if (client >= server + 2) {
    kind = "client";
    confidence = client >= 4 ? "high" : client >= 2 ? "medium" : "low";
  } else if (server >= client + 2) {
    kind = "server";
    confidence = server >= 4 ? "high" : server >= 2 ? "medium" : "low";
  } else if (client > 0 && server > 0) {
    kind = "both";
    confidence = "low";
  } else if (client > server) {
    kind = "client";
    confidence = "low";
  } else if (server > client) {
    kind = "server";
    confidence = "low";
  } else {
    kind = "unclear";
    confidence = "low";
  }

  return {
    kind,
    label: labelFor(kind),
    confidence,
    reasons: reasons.slice(0, 6),
  };
}

/** Hide runtime in the UI when the heuristic is a guess. */
export const isConfidentRuntime = (runtime?: {
  kind?: RuntimeKind;
  confidence?: RuntimeConfidence;
} | null): boolean => {
  if (!runtime?.kind || runtime.kind === "unclear") return false;
  return runtime.confidence === "high" || runtime.confidence === "medium";
};
