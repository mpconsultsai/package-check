import { validatePackageNameForEcosystem } from "@/lib/packages/validation";
import {
  PASTE_LIST_MAX_PACKAGES,
  type ParsedDependency,
  type ParseDependencyListResult,
} from "@/lib/parse/parse-dependency-list";

function addEntry(
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

function parseDependencyBlocks(input: string): ParsedDependency[] {
  const entries: ParsedDependency[] = [];
  const pattern = /<dependency>([\s\S]*?)<\/dependency>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    const block = match[1];
    const groupId = block.match(/<groupId>\s*([^<]+)\s*<\/groupId>/i)?.[1]?.trim();
    const artifactId = block
      .match(/<artifactId>\s*([^<]+)\s*<\/artifactId>/i)?.[1]
      ?.trim();
    const version = block.match(/<version>\s*([^<]+)\s*<\/version>/i)?.[1]?.trim();
    if (!groupId || !artifactId) continue;
    const name = `${groupId}:${artifactId}`;
    if (!validatePackageNameForEcosystem(name, "maven").valid) continue;
    entries.push({ name, requested: version || undefined });
  }
  return entries;
}

function parseMavenLines(input: string): ParseDependencyListResult {
  const seen = new Map<string, ParsedDependency>();
  let invalidCount = 0;

  for (const raw of input.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//") || line.startsWith("<")) {
      continue;
    }
    const token = line.split(/\s+/)[0] ?? "";
    const parts = token.split(":");
    if (parts.length < 2) {
      invalidCount += 1;
      continue;
    }
    const name = `${parts[0]}:${parts[1]}`;
    if (!validatePackageNameForEcosystem(name, "maven").valid) {
      invalidCount += 1;
      continue;
    }
    addEntry({ name, requested: parts[2] || undefined }, seen);
  }

  const entries = [...seen.values()].slice(0, PASTE_LIST_MAX_PACKAGES);
  return {
    packages: entries.map((entry) => entry.name),
    entries,
    invalidCount,
    truncated: seen.size > PASTE_LIST_MAX_PACKAGES,
    source: "package list",
  };
}

/** Parse Maven POM dependency XML or `groupId:artifactId[:version]` lines. */
export function parseMavenPackageList(input: string): ParseDependencyListResult {
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

  if (/<dependency\b/i.test(text)) {
    const seen = new Map<string, ParsedDependency>();
    for (const entry of parseDependencyBlocks(text)) {
      addEntry(entry, seen);
    }
    const entries = [...seen.values()].slice(0, PASTE_LIST_MAX_PACKAGES);
    return {
      packages: entries.map((entry) => entry.name),
      entries,
      invalidCount: 0,
      truncated: seen.size > PASTE_LIST_MAX_PACKAGES,
      source: "text",
    };
  }

  return parseMavenLines(text);
}
