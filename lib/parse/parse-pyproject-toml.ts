import { parse as parseToml } from "smol-toml";
import {
  PASTE_LIST_MAX_PACKAGES,
  type ParsedDependency,
  type ParseDependencyListResult,
} from "@/lib/parse/parse-dependency-list";
import { parsePep508Line } from "@/lib/parse/parse-pep508-line";

const POETRY_SKIP_KEYS = new Set([
  "python",
  "version",
  "package-mode",
  "importlib-metadata",
]);

function looksLikePyprojectToml(text: string): boolean {
  if (!/\[[\w."'-]+\]/m.test(text)) return false;
  return (
    /^\s*\[project(?:\.|$)/m.test(text) ||
    /^\s*\[tool\.(?:poetry|pdm|uv)/m.test(text) ||
    /^\s*\[dependency-groups\]/m.test(text) ||
    /^\s*\[project\.optional-dependencies\]/m.test(text)
  );
}

function addPyPiEntry(
  entry: ParsedDependency,
  seen: Map<string, ParsedDependency>,
) {
  const key = entry.name.toLowerCase();
  const existing = seen.get(key);
  if (existing) {
    if (!existing.requested && entry.requested) {
      seen.set(key, { name: entry.name, requested: entry.requested });
    }
    return;
  }
  seen.set(key, entry);
}

function collectPep508Strings(
  value: unknown,
  seen: Map<string, ParsedDependency>,
  invalid: { count: number },
) {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (typeof item !== "string") {
      invalid.count += 1;
      continue;
    }
    const parsed = parsePep508Line(item);
    if (parsed) addPyPiEntry(parsed, seen);
    else invalid.count += 1;
  }
}

function collectPoetryStyleTable(
  value: unknown,
  seen: Map<string, ParsedDependency>,
  invalid: { count: number },
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const [name, spec] of Object.entries(value as Record<string, unknown>)) {
    if (POETRY_SKIP_KEYS.has(name.toLowerCase())) continue;
    if (typeof spec === "string") {
      const trimmed = spec.trim();
      const asPep508 = parsePep508Line(trimmed.includes(name) ? trimmed : `${name}${trimmed}`);
      if (asPep508 && asPep508.name.toLowerCase() === name.toLowerCase()) {
        addPyPiEntry(asPep508, seen);
      } else {
        addPyPiEntry({ name, requested: trimmed || undefined }, seen);
      }
      continue;
    }
    if (spec && typeof spec === "object" && !Array.isArray(spec)) {
      const version = (spec as { version?: unknown }).version;
      if (typeof version === "string") {
        addPyPiEntry({ name, requested: version.trim() || undefined }, seen);
        continue;
      }
    }
    invalid.count += 1;
  }
}

function collectOptionalDependencyGroups(
  value: unknown,
  seen: Map<string, ParsedDependency>,
  invalid: { count: number },
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const group of Object.values(value as Record<string, unknown>)) {
    collectPep508Strings(group, seen, invalid);
  }
}

/** Parse pyproject.toml (PEP 621, Poetry, dependency-groups). */
export function parsePyprojectToml(
  input: string,
): ParseDependencyListResult | null {
  const text = input.trim();
  if (!text || !looksLikePyprojectToml(text)) return null;

  let doc: unknown;
  try {
    doc = parseToml(text);
  } catch {
    return null;
  }

  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return null;
  }

  const root = doc as Record<string, unknown>;
  const seen = new Map<string, ParsedDependency>();
  const invalid = { count: 0 };

  const project = root.project as Record<string, unknown> | undefined;
  if (project) {
    collectPep508Strings(project.dependencies, seen, invalid);
    collectOptionalDependencyGroups(
      project["optional-dependencies"],
      seen,
      invalid,
    );
  }

  collectPep508Strings(root["dependency-groups"], seen, invalid);

  const tool = root.tool as Record<string, unknown> | undefined;
  const poetry = tool?.poetry as Record<string, unknown> | undefined;
  if (poetry) {
    collectPoetryStyleTable(poetry.dependencies, seen, invalid);
    collectPoetryStyleTable(poetry["dev-dependencies"], seen, invalid);
    const group = poetry.group as
      | Record<string, { dependencies?: unknown }>
      | undefined;
    if (group) {
      for (const entry of Object.values(group)) {
        collectPoetryStyleTable(entry?.dependencies, seen, invalid);
      }
    }
  }

  const pdm = tool?.pdm as Record<string, unknown> | undefined;
  if (pdm) {
    collectPoetryStyleTable(pdm["dev-dependencies"], seen, invalid);
  }

  const uv = tool?.uv as Record<string, unknown> | undefined;
  if (uv) {
    collectPoetryStyleTable(uv["dev-dependencies"], seen, invalid);
  }

  const entries = [...seen.values()].slice(0, PASTE_LIST_MAX_PACKAGES);
  return {
    packages: entries.map((e) => e.name),
    entries,
    invalidCount: invalid.count,
    truncated: seen.size > PASTE_LIST_MAX_PACKAGES,
    source: "pyproject.toml",
  };
}

export { looksLikePyprojectToml };
