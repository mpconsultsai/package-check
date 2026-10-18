export type NpmModuleFormat = "cjs" | "esm" | "dual";

export type BundleModuleShare = {
  name: string;
  bytes: number;
  /** Share of the minified bundle, from 0 to 1. */
  share: number;
};

const EXPORT_CONDITIONS = new Set(["import", "require", "types"]);

function collectExportConditions(
  value: unknown,
  found: Set<string>,
  depth: number,
) {
  if (depth > 8 || value == null || typeof value === "string") return;
  if (Array.isArray(value)) {
    for (const item of value) collectExportConditions(item, found, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (EXPORT_CONDITIONS.has(key)) found.add(key);
    collectExportConditions(child, found, depth + 1);
  }
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** CommonJS, ESM, or both, from the fields npm already published. */
export function classifyNpmModuleFormat(pkg: {
  type?: unknown;
  main?: unknown;
  module?: unknown;
  exports?: unknown;
}): NpmModuleFormat {
  const conditions = new Set<string>();
  collectExportConditions(pkg.exports, conditions, 0);
  const hasImport = conditions.has("import");
  const hasRequire = conditions.has("require");
  const typeModule = pkg.type === "module";
  const hasModuleField = nonEmptyString(pkg.module);
  const hasMain = nonEmptyString(pkg.main);

  if (hasImport && hasRequire) return "dual";
  if (hasRequire && typeModule) return "dual";
  if (hasModuleField && hasMain) return "dual";
  if (typeModule || hasImport || hasModuleField) return "esm";
  return "cjs";
}

export function npmModuleFormatLabel(format: NpmModuleFormat): string {
  if (format === "esm") return "ESM";
  if (format === "dual") return "ESM and CommonJS";
  return "CommonJS";
}

/** True when package.json declares a TypeScript entry. */
export function npmTypesIncluded(pkg: {
  types?: unknown;
  typings?: unknown;
  exports?: unknown;
}): boolean {
  if (nonEmptyString(pkg.types) || nonEmptyString(pkg.typings)) return true;
  const conditions = new Set<string>();
  collectExportConditions(pkg.exports, conditions, 0);
  return conditions.has("types");
}

export function npmMaintainerNames(
  maintainers:
    | Array<{ name?: string | null } | null | undefined>
    | null
    | undefined,
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const maintainer of maintainers ?? []) {
    const name = maintainer?.name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

export function npmMaintainerGithubUrl(name: string): string {
  return `https://github.com/${encodeURIComponent(name)}`;
}

/** Modules that account for a real share of the minified bundle. */
export function topBundleModules(
  modules:
    | Array<{ name?: string; approximateSize?: number } | null | undefined>
    | null
    | undefined,
  totalSize: number,
  limit = 4,
): BundleModuleShare[] {
  if (!Number.isFinite(totalSize) || totalSize <= 0) return [];
  return (modules ?? [])
    .flatMap((mod) => {
      const name = mod?.name?.trim() ?? "";
      const bytes = Number(mod?.approximateSize);
      if (!name || !Number.isFinite(bytes) || bytes <= 0) return [];
      return [{ name, bytes, share: bytes / totalSize }];
    })
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, limit)
    .filter((mod) => mod.share >= 0.05);
}
