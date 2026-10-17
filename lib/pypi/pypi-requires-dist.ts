import { parsePep508Line } from "@/lib/parse/parse-pep508-line";
import type { PackageDependency } from "@/lib/packages/package-deps";

export type PypiInstallRequirements = {
  requiresPython: string | null;
  providesExtra: string[];
  core: PackageDependency[];
  /** Installed only when marker matches (e.g. Windows-only). */
  conditional: Array<PackageDependency & { marker: string }>;
  /** Extra name → additional requirements for `pip install pkg[extra]`. */
  extras: Record<string, PackageDependency[]>;
};

function extractExtraFromMarker(marker: string): string | null {
  const normalized = marker.replace(/\s+/g, " ");
  const quoted = normalized.match(
    /extra\s*===?\s*["']([^"']+)["']/i,
  );
  if (quoted) return quoted[1];
  const bare = normalized.match(/extra\s*===?\s*([A-Za-z0-9._-]+)/i);
  return bare ? bare[1] : null;
}

function toDep(name: string, range: string): PackageDependency {
  return { name, range: range || "*", kind: "runtime" };
}

function parseRequiresDistLine(
  line: string,
): (PackageDependency & { marker?: string; extra?: string }) | null {
  let req = line.trim();
  if (!req) return null;

  let marker: string | undefined;
  const semi = req.indexOf(";");
  if (semi >= 0) {
    marker = req.slice(semi + 1).trim();
    req = req.slice(0, semi).trim();
  }

  const parsed = parsePep508Line(req);
  if (!parsed) return null;

  const range = parsed.requested ?? "*";
  const dep = toDep(parsed.name, range);
  if (!marker) return dep;

  const extra = extractExtraFromMarker(marker);
  if (extra) {
    return { ...dep, extra, marker };
  }
  return { ...dep, marker };
}

/** Classify PyPI Requires-Dist lines for default vs optional extras. */
export function parsePypiRequiresDist(
  requiresDist: string[] | null | undefined,
  providesExtra: string[] | null | undefined,
  requiresPython: string | null | undefined,
): PypiInstallRequirements {
  const core: PackageDependency[] = [];
  const conditional: Array<PackageDependency & { marker: string }> = [];
  const extras: Record<string, PackageDependency[]> = {};
  const extraNames = new Set<string>();

  for (const raw of requiresDist ?? []) {
    const parsed = parseRequiresDistLine(raw);
    if (!parsed) continue;

    if (parsed.extra) {
      extraNames.add(parsed.extra);
      const list = extras[parsed.extra] ?? [];
      list.push(toDep(parsed.name, parsed.range));
      extras[parsed.extra] = list;
      continue;
    }

    if (parsed.marker) {
      conditional.push({
        ...toDep(parsed.name, parsed.range),
        marker: parsed.marker,
      });
      continue;
    }

    core.push(toDep(parsed.name, parsed.range));
  }

  for (const name of providesExtra ?? []) {
    if (typeof name === "string" && name.trim()) {
      extraNames.add(name.trim());
    }
  }

  for (const extra of extraNames) {
    if (!extras[extra]) extras[extra] = [];
  }

  const providesExtraSorted = [...extraNames].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );

  for (const list of Object.values(extras)) {
    list.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  }

  return {
    requiresPython:
      typeof requiresPython === "string" && requiresPython.trim()
        ? requiresPython.trim()
        : null,
    providesExtra: providesExtraSorted,
    core,
    conditional,
    extras,
  };
}

/** Flat core dependencies map (default install only). */
export function coreDependenciesMap(
  install: PypiInstallRequirements,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dep of install.core) {
    out[dep.name] = dep.range;
  }
  return out;
}
