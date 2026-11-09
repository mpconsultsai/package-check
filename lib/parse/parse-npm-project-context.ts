import {
  parseDependencyList,
  type ParseDependencyListResult,
} from "@/lib/parse/parse-dependency-list";

/** Higher than paste-list — Upgrade needs peers that may not be in the top 40. */
export const NPM_PROJECT_CONTEXT_MAX_PACKAGES = 200;

export type NpmProjectContextSource =
  | ParseDependencyListResult["source"]
  | "empty";

export type NpmProjectContextParsed = {
  deps: Record<string, string>;
  enginesNode: string | null;
  source: NpmProjectContextSource;
  packageCount: number;
  truncated: boolean;
  invalidCount: number;
};

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readEnginesNode(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const engines = (value as { engines?: unknown }).engines;
  if (!engines || typeof engines !== "object" || Array.isArray(engines)) {
    return null;
  }
  const node = (engines as { node?: unknown }).node;
  if (typeof node !== "string") return null;
  const trimmed = node.trim();
  return trimmed || null;
}

function mergeDependencyRecords(
  ...records: Array<unknown>
): Record<string, string> {
  const deps: Record<string, string> = {};
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) continue;
    for (const [name, value] of Object.entries(
      record as Record<string, unknown>,
    )) {
      if (typeof value !== "string" || !value.trim()) continue;
      const key = name.trim();
      if (!key) continue;
      // Prefer first declaration (deps over peer/optional).
      if (!(key in deps)) deps[key] = value.trim();
    }
  }
  return deps;
}

/**
 * Resolve an overrides/resolutions key to a package name.
 * Handles scoped names, name@version selectors, and yarn path forms
 * (star-star/foo, parent/foo).
 */
function overridePackageName(key: string): string | null {
  let name = key.trim();
  if (!name || name === ".") return null;
  if (name.startsWith("**/")) name = name.slice(3);

  if (name.startsWith("@")) {
    const withoutAt = name.slice(1);
    const slash = withoutAt.indexOf("/");
    if (slash === -1) return null;
    const scope = withoutAt.slice(0, slash);
    let rest = withoutAt.slice(slash + 1);
    if (rest.includes("/")) {
      rest = rest.slice(rest.lastIndexOf("/") + 1);
      const at = rest.lastIndexOf("@");
      if (at > 0) rest = rest.slice(0, at);
      return rest || null;
    }
    const at = rest.lastIndexOf("@");
    if (at > 0) rest = rest.slice(0, at);
    return rest ? `@${scope}/${rest}` : null;
  }

  if (name.includes("/")) {
    name = name.slice(name.lastIndexOf("/") + 1);
  }
  const at = name.lastIndexOf("@");
  if (at > 0) name = name.slice(0, at);
  return name || null;
}

/**
 * Flatten npm overrides, Yarn resolutions, and pnpm.overrides into package→spec
 * pins. Nested objects use `"."` for the parent pin; nested string keys pin
 * those packages too (useful for peer-fit checks).
 */
export function collectOverridePins(
  record: unknown,
  into: Record<string, string> = {},
): Record<string, string> {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return into;
  }
  for (const [key, value] of Object.entries(
    record as Record<string, unknown>,
  )) {
    if (typeof value === "string" && value.trim()) {
      const name = overridePackageName(key);
      if (name) into[name] = value.trim();
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const nested = value as Record<string, unknown>;
    if (typeof nested["."] === "string" && nested["."].trim()) {
      const name = overridePackageName(key);
      if (name) into[name] = nested["."].trim();
    }
    for (const [childKey, childVal] of Object.entries(nested)) {
      if (childKey === ".") continue;
      if (typeof childVal === "string" && childVal.trim()) {
        const childName = overridePackageName(childKey);
        if (childName) into[childName] = childVal.trim();
        continue;
      }
      if (childVal && typeof childVal === "object" && !Array.isArray(childVal)) {
        collectOverridePins({ [childKey]: childVal }, into);
      }
    }
  }
  return into;
}

function readOverridePins(obj: Record<string, unknown>): Record<string, string> {
  const pins: Record<string, string> = {};
  collectOverridePins(obj.overrides, pins);
  collectOverridePins(obj.resolutions, pins);
  const pnpm = obj.pnpm;
  if (pnpm && typeof pnpm === "object" && !Array.isArray(pnpm)) {
    collectOverridePins(
      (pnpm as { overrides?: unknown }).overrides,
      pins,
    );
  }
  return pins;
}

function capDeps(
  deps: Record<string, string>,
): { deps: Record<string, string>; truncated: boolean } {
  const names = Object.keys(deps);
  if (names.length <= NPM_PROJECT_CONTEXT_MAX_PACKAGES) {
    return { deps, truncated: false };
  }
  return {
    truncated: true,
    deps: Object.fromEntries(
      names
        .slice(0, NPM_PROJECT_CONTEXT_MAX_PACKAGES)
        .map((name) => [name, deps[name]]),
    ),
  };
}

function parsePackageLockPackages(
  packagesField: Record<string, unknown>,
): Record<string, string> {
  const deps: Record<string, string> = {};
  for (const [key, value] of Object.entries(packagesField)) {
    if (!key) continue;
    const marker = "node_modules/";
    const idx = key.lastIndexOf(marker);
    if (idx === -1) continue;
    const name = key.slice(idx + marker.length);
    if (!name || name.includes("node_modules/")) continue;
    const version =
      value &&
      typeof value === "object" &&
      typeof (value as { version?: unknown }).version === "string"
        ? (value as { version: string }).version.trim()
        : "";
    if (!version || name in deps) continue;
    deps[name] = version;
    if (Object.keys(deps).length >= NPM_PROJECT_CONTEXT_MAX_PACKAGES) break;
  }
  return deps;
}

/**
 * Build a flat project dependency map + engines.node from package.json
 * or lockfile text. Declared ranges preferred; lockfiles contribute resolved
 * versions when that is all we have.
 */
export function parseNpmProjectContext(input: string): NpmProjectContextParsed {
  const text = input.trim();
  if (!text) {
    return {
      deps: {},
      enginesNode: null,
      source: "empty",
      packageCount: 0,
      truncated: false,
      invalidCount: 0,
    };
  }

  const json = tryParseJson(text);

  // Structured package.json — keep ranges without the paste-list 40 cap.
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const obj = json as Record<string, unknown>;
    const packagesField =
      obj.packages && typeof obj.packages === "object" && !Array.isArray(obj.packages)
        ? (obj.packages as Record<string, unknown>)
        : null;
    const looksLikeLock =
      Boolean(packagesField) &&
      (obj.lockfileVersion !== undefined ||
        typeof obj.name === "string" ||
        packagesField?.[""] !== undefined);
    const pnpmOverrides =
      obj.pnpm &&
      typeof obj.pnpm === "object" &&
      !Array.isArray(obj.pnpm) &&
      (obj.pnpm as { overrides?: unknown }).overrides;
    const looksLikePackageJson = Boolean(
      obj.dependencies ||
        obj.devDependencies ||
        obj.peerDependencies ||
        obj.optionalDependencies ||
        obj.overrides ||
        obj.resolutions ||
        pnpmOverrides,
    );

    if (looksLikePackageJson && !looksLikeLock) {
      const merged = mergeDependencyRecords(
        obj.dependencies,
        obj.devDependencies,
        obj.peerDependencies,
        obj.optionalDependencies,
      );
      // Overrides / resolutions win — they force what the project installs.
      Object.assign(merged, readOverridePins(obj));
      const capped = capDeps(merged);
      return {
        deps: capped.deps,
        enginesNode: readEnginesNode(obj),
        source: "package.json",
        packageCount: Object.keys(capped.deps).length,
        truncated: capped.truncated,
        invalidCount: 0,
      };
    }

    if (looksLikeLock && packagesField) {
      const deps = parsePackageLockPackages(packagesField);
      const capped = capDeps(deps);
      const root = packagesField[""];
      return {
        deps: capped.deps,
        enginesNode: readEnginesNode(root) ?? readEnginesNode(obj),
        source: "package-lock",
        packageCount: Object.keys(capped.deps).length,
        truncated: capped.truncated,
        invalidCount: 0,
      };
    }
  }

  // yarn.lock / fallback — reuse the shared list parser, then lift the cap.
  const listed = parseDependencyList(text);
  const deps: Record<string, string> = {};
  for (const entry of listed.entries) {
    if (!entry.requested) continue;
    deps[entry.name] = entry.requested;
  }

  // When the shared parser truncated at 40, expand via a second lock pass.
  if (
    listed.truncated &&
    listed.source === "package-lock" &&
    json &&
    typeof json === "object" &&
    !Array.isArray(json)
  ) {
    const packagesField = (json as { packages?: unknown }).packages;
    if (packagesField && typeof packagesField === "object") {
      for (const [name, version] of Object.entries(
        parsePackageLockPackages(packagesField as Record<string, unknown>),
      )) {
        if (!(name in deps)) deps[name] = version;
      }
    }
  }

  const capped = capDeps(deps);
  return {
    deps: capped.deps,
    enginesNode: readEnginesNode(json),
    source: listed.source === "empty" ? "empty" : listed.source,
    packageCount: Object.keys(capped.deps).length,
    truncated: capped.truncated || (listed.truncated && listed.source !== "package-lock"),
    invalidCount: listed.invalidCount,
  };
}

/** Fingerprint for cache keys — stable across key order. */
export function fingerprintNpmProjectContext(
  deps: Record<string, string>,
  enginesNode: string | null,
): string {
  const parts = Object.keys(deps)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => `${name}@${deps[name]}`);
  if (enginesNode) parts.push(`engines.node=${enginesNode}`);
  const joined = parts.join(";");
  if (joined.length <= 120) return joined || "empty";
  let hash = 0;
  for (let i = 0; i < joined.length; i++) {
    hash = (hash * 31 + joined.charCodeAt(i)) | 0;
  }
  return `n${parts.length}:${(hash >>> 0).toString(36)}`;
}
