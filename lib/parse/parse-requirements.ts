import {
  parsePyprojectToml,
  looksLikePyprojectToml,
} from "@/lib/parse/parse-pyproject-toml";
import { parsePep508Line } from "@/lib/parse/parse-pep508-line";
import { parseNugetPackageList } from "@/lib/parse/parse-nuget-list";
import { parseMavenPackageList } from "@/lib/parse/parse-maven-list";
import type { PackageEcosystem } from "@/lib/packages/package-routes";
import {
  parseDependencyList,
  PASTE_LIST_MAX_PACKAGES,
  type ParsedDependency,
  type ParseDependencyListResult,
} from "@/lib/parse/parse-dependency-list";

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

/**
 * Parse requirements.txt / PEP 508 lines into PyPI project entries.
 */
function parseRequirementsTxt(input: string): ParseDependencyListResult {
  const seen = new Map<string, ParsedDependency>();
  let invalidCount = 0;

  for (const raw of input.split(/\r?\n/)) {
    const parsed = parsePep508Line(raw);
    if (parsed) {
      addPyPiEntry(parsed, seen);
      continue;
    }
    if (raw.trim() && !raw.trim().startsWith("#")) {
      invalidCount += 1;
    }
  }

  const entries = [...seen.values()].slice(0, PASTE_LIST_MAX_PACKAGES);
  return {
    packages: entries.map((e) => e.name),
    entries,
    invalidCount,
    truncated: seen.size > PASTE_LIST_MAX_PACKAGES,
    source: "requirements.txt",
  };
}

/**
 * Parse requirements.txt, pyproject.toml, or PEP 508 lines into PyPI entries.
 */
export function parseRequirementsList(input: string): ParseDependencyListResult {
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

  if (looksLikePyprojectToml(text)) {
    const fromToml = parsePyprojectToml(text);
    if (fromToml) return fromToml;
  }

  return parseRequirementsTxt(text);
}

export function parseDependencyListForEcosystem(
  input: string,
  ecosystem: PackageEcosystem,
): ParseDependencyListResult {
  if (ecosystem === "pypi") return parseRequirementsList(input);
  if (ecosystem === "nuget") return parseNugetPackageList(input);
  if (ecosystem === "maven") return parseMavenPackageList(input);
  return parseDependencyList(input);
}
