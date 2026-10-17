import {
  extractPackageName,
  normalizeNpmPackageName,
  validatePackageName,
} from "@/lib/packages/validation";

export const PASTE_LIST_MAX_PACKAGES = 40;

export interface ParsedDependency {
  name: string;
  /** Version / range from the paste, when known (e.g. ^19.0.0 or 19.0.1) */
  requested?: string;
}

export interface ParseDependencyListResult {
  packages: string[];
  entries: ParsedDependency[];
  invalidCount: number;
  truncated: boolean;
  source:
    | "package.json"
    | "package-lock"
    | "yarn.lock"
    | "requirements.txt"
    | "pyproject.toml"
    | "csproj"
    | "package list"
    | "text"
    | "empty";
}

/** Manifest / lockfile field names that must never be treated as packages. */
const RESERVED_PACKAGE_JSON_KEYS = new Set([
  "dependencies",
  "devdependencies",
  "peerdependencies",
  "optionaldependencies",
  "bundleddependencies",
  "bundledependencies",
  "name",
  "version",
  "description",
  "main",
  "module",
  "types",
  "typings",
  "scripts",
  "license",
  "author",
  "contributors",
  "repository",
  "homepage",
  "bugs",
  "keywords",
  "engines",
  "os",
  "cpu",
  "private",
  "workspaces",
  "packagemanager",
  "exports",
  "imports",
  "bin",
  "files",
  "publishconfig",
  "resolutions",
  "overrides",
  "pnpm",
  "package",
  "packages",
  "lockfileversion",
  "requires",
  "dependenciesmeta",
  "__metadata",
]);

function isReservedKey(name: string): boolean {
  return RESERVED_PACKAGE_JSON_KEYS.has(name.toLowerCase());
}

/** Values that look like dependency version ranges, not nested objects. */
function looksLikeVersionSpec(value: string): boolean {
  const v = value.trim();
  if (!v || v === "{" || v === "[" || v === "}") return false;
  return (
    /^[\^~>=<\d*]/.test(v) ||
    /^(workspace|file|link|portal|npm|git\+?|http|https|ssh):/i.test(v) ||
    v.startsWith("github:") ||
    v.startsWith("gist:") ||
    v.startsWith("bitbucket:") ||
    v.startsWith("gitlab:") ||
    v === "latest" ||
    v === "*"
  );
}

function addEntry(
  rawName: string,
  requested: string | undefined,
  seen: Map<string, ParsedDependency>,
  invalid: { count: number },
) {
  const stripped = stripVersionConstraint(rawName);
  const name = normalizeNpmPackageName(extractPackageName(stripped));
  if (!name) return;
  if (isReservedKey(name)) return;
  if (!validatePackageName(name).valid) {
    invalid.count += 1;
    return;
  }
  const key = name.toLowerCase();
  const existing = seen.get(key);
  const cleanRequested =
    requested && looksLikeVersionSpec(requested) ? requested.trim() : undefined;

  if (existing) {
    // Prefer a concrete requested version if we learn one later
    if (!existing.requested && cleanRequested) {
      seen.set(key, { name: existing.name, requested: cleanRequested });
    }
    return;
  }
  seen.set(key, { name, requested: cleanRequested });
}

/** react@18.2.0 / @scope/pkg@^1.0.0 → package name only */
export function stripVersionConstraint(input: string): string {
  const trimmed = input.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed) return "";

  if (trimmed.startsWith("@")) {
    const slash = trimmed.indexOf("/");
    if (slash === -1) return trimmed;
    const afterSlash = trimmed.slice(slash + 1);
    const at = afterSlash.indexOf("@");
    if (at === -1) return trimmed;
    return `${trimmed.slice(0, slash + 1)}${afterSlash.slice(0, at)}`;
  }

  const at = trimmed.indexOf("@");
  if (at > 0) return trimmed.slice(0, at);
  return trimmed;
}

function fromDependencyRecord(
  record: unknown,
  seen: Map<string, ParsedDependency>,
  invalid: { count: number },
) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return;
  for (const [key, value] of Object.entries(
    record as Record<string, unknown>,
  )) {
    const requested = typeof value === "string" ? value : undefined;
    addEntry(key, requested, seen, invalid);
  }
}

function fromPackageLockPackages(
  packagesField: unknown,
  seen: Map<string, ParsedDependency>,
  invalid: { count: number },
) {
  if (!packagesField || typeof packagesField !== "object") return;
  for (const [key, value] of Object.entries(
    packagesField as Record<string, unknown>,
  )) {
    if (!key || key === "") continue;
    const marker = "node_modules/";
    const idx = key.lastIndexOf(marker);
    if (idx === -1) continue;
    const name = key.slice(idx + marker.length);
    if (!name || name.includes("node_modules/")) continue;
    const version =
      value &&
      typeof value === "object" &&
      typeof (value as { version?: unknown }).version === "string"
        ? (value as { version: string }).version
        : undefined;
    addEntry(name, version, seen, invalid);
  }
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractJsonDependencyPairs(text: string): ParsedDependency[] {
  const pairs: ParsedDependency[] = [];
  const pairRe =
    /"(@?[a-z0-9-~][a-z0-9-._~]*\/[a-z0-9-~][a-z0-9-._~]*|[a-z0-9-~][a-z0-9-._~]*)"\s*:\s*"([^"]*)"/gi;
  let match: RegExpExecArray | null;
  while ((match = pairRe.exec(text)) !== null) {
    const key = match[1];
    const value = match[2];
    if (isReservedKey(key)) continue;
    if (!looksLikeVersionSpec(value)) continue;
    pairs.push({ name: key, requested: value });
  }
  return pairs;
}

function looksLikeManifestText(text: string): boolean {
  return /"(dependencies|devDependencies|peerDependencies|optionalDependencies|packages|lockfileVersion)"\s*:/i.test(
    text,
  );
}

function parseYarnLockNames(text: string): ParsedDependency[] {
  const entries: ParsedDependency[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(" ")) continue;
    if (!trimmed.endsWith(":")) continue;
    const header = trimmed.slice(0, -1);
    for (const part of header.split(",")) {
      const token = part.trim().replace(/^"|"$/g, "");
      if (!token || token === "__metadata" || isReservedKey(token)) continue;
      const cleaned = token.replace(/@npm:.+$/, "");
      const name = stripVersionConstraint(cleaned);
      const at = cleaned.startsWith("@")
        ? cleaned.indexOf("@", 1)
        : cleaned.indexOf("@");
      const requested = at > 0 ? cleaned.slice(at + 1) : undefined;
      entries.push({ name, requested });
    }
  }
  return entries;
}

function parsePlainTextNames(text: string): ParsedDependency[] {
  return text
    .split(/[\n,;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const jsonPair = part.match(
        /^"?(@?[a-z0-9-~][a-z0-9-._~/]*)"?\s*:\s*"?([^"{},]+)"?\s*,?$/i,
      );
      if (jsonPair) {
        if (isReservedKey(jsonPair[1])) return [];
        if (!looksLikeVersionSpec(jsonPair[2])) return [];
        return [{ name: jsonPair[1], requested: jsonPair[2].trim() }];
      }

      const bare = part.replace(/^["']|["']$/g, "");
      if (isReservedKey(bare)) return [];
      if (/^[{}\[\],]$/.test(bare)) return [];
      if (bare.endsWith(":")) return [];

      // name@version
      if (bare.includes("@") && !bare.startsWith("@")) {
        return [
          {
            name: stripVersionConstraint(bare),
            requested: bare.slice(bare.indexOf("@") + 1) || undefined,
          },
        ];
      }
      if (bare.startsWith("@")) {
        const slash = bare.indexOf("/");
        const at = slash >= 0 ? bare.indexOf("@", slash) : -1;
        if (at > 0) {
          return [
            {
              name: stripVersionConstraint(bare),
              requested: bare.slice(at + 1) || undefined,
            },
          ];
        }
      }
      return [{ name: bare }];
    });
}

/**
 * Extract unique npm package names from package.json, package-lock,
 * yarn.lock snippets, or a plain list of names.
 */
export function parseDependencyList(input: string): ParseDependencyListResult {
  const text = input.trim();
  if (!text) {
    return {
      packages: [],
      entries: [],
      invalidCount: 0,
      truncated: false,
      source: "empty",
    };
  }

  const seen = new Map<string, ParsedDependency>();
  const invalid = { count: 0 };
  let source: ParseDependencyListResult["source"] = "text";

  const json = tryParseJson(text);
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const obj = json as Record<string, unknown>;

    if (
      obj.packages &&
      typeof obj.packages === "object" &&
      (obj.lockfileVersion !== undefined || obj.name !== undefined)
    ) {
      source = "package-lock";
      fromPackageLockPackages(obj.packages, seen, invalid);
    } else if (
      obj.dependencies ||
      obj.devDependencies ||
      obj.peerDependencies ||
      obj.optionalDependencies
    ) {
      source = "package.json";
      fromDependencyRecord(obj.dependencies, seen, invalid);
      fromDependencyRecord(obj.devDependencies, seen, invalid);
      fromDependencyRecord(obj.peerDependencies, seen, invalid);
      fromDependencyRecord(obj.optionalDependencies, seen, invalid);
    } else if (obj.packages && typeof obj.packages === "object") {
      source = "package-lock";
      fromPackageLockPackages(obj.packages, seen, invalid);
    }
  } else if (
    text.includes("yarn lockfile") ||
    text.startsWith("# yarn lockfile") ||
    (/^\S+@.+:\s*$/m.test(text) && !looksLikeManifestText(text))
  ) {
    source = "yarn.lock";
    for (const entry of parseYarnLockNames(text)) {
      addEntry(entry.name, entry.requested, seen, invalid);
    }
  }

  if (seen.size === 0 && looksLikeManifestText(text)) {
    source = "package.json";
    for (const entry of extractJsonDependencyPairs(text)) {
      addEntry(entry.name, entry.requested, seen, invalid);
    }
  }

  if (seen.size === 0 && !looksLikeManifestText(text)) {
    source = "text";
    for (const entry of parsePlainTextNames(text)) {
      addEntry(entry.name, entry.requested, seen, invalid);
    }
  }

  const entries = [...seen.values()].slice(0, PASTE_LIST_MAX_PACKAGES);
  const truncated = seen.size > PASTE_LIST_MAX_PACKAGES;
  return {
    packages: entries.map((e) => e.name),
    entries,
    invalidCount: invalid.count,
    truncated,
    source,
  };
}
