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

function parsePackageReferences(input: string): ParsedDependency[] {
  const entries: ParsedDependency[] = [];
  const pattern =
    /<PackageReference\b[^>]*\bInclude\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    const name = match[1]?.trim() ?? "";
    if (!validatePackageNameForEcosystem(name, "nuget").valid) continue;
    const tag = match[0];
    const versionMatch = tag.match(/\bVersion\s*=\s*["']([^"']+)["']/i);
    const selfClosing = /\/>\s*$/.test(tag);
    let requested = versionMatch?.[1]?.trim();
    if (!requested && !selfClosing) {
      const close = input.indexOf("</PackageReference>", match.index);
      const body =
        close === -1
          ? ""
          : input.slice(match.index + tag.length, close);
      const child = body.match(
        /<Version>\s*([^<]+?)\s*<\/Version>/i,
      );
      requested = child?.[1]?.trim();
    }
    entries.push({ name, requested: requested || undefined });
  }
  return entries;
}

function parseNugetLines(input: string): ParseDependencyListResult {
  const seen = new Map<string, ParsedDependency>();
  let invalidCount = 0;

  for (const raw of input.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//") || line.startsWith("<")) {
      continue;
    }
    const token = line.split(/\s+/)[0] ?? "";
    if (!validatePackageNameForEcosystem(token, "nuget").valid) {
      invalidCount += 1;
      continue;
    }
    addEntry({ name: token }, seen);
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

/** Parse PackageReference XML or a plain list of NuGet package ids. */
export function parseNugetPackageList(input: string): ParseDependencyListResult {
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

  if (/<PackageReference\b/i.test(text)) {
    const seen = new Map<string, ParsedDependency>();
    for (const entry of parsePackageReferences(text)) {
      addEntry(entry, seen);
    }
    const entries = [...seen.values()].slice(0, PASTE_LIST_MAX_PACKAGES);
    return {
      packages: entries.map((entry) => entry.name),
      entries,
      invalidCount: 0,
      truncated: seen.size > PASTE_LIST_MAX_PACKAGES,
      source: "csproj",
    };
  }

  return parseNugetLines(text);
}
