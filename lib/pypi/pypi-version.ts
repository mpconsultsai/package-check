import semver from "semver";

const TIME_META = new Set(["created", "modified", "unpublished"]);

/** PEP 440 pre-releases (post-releases are stable). */
export function isPypiPrerelease(version: string): boolean {
  const v = version.trim();
  if (!v) return true;
  if (/\.post\d+/i.test(v)) return false;
  if (/(?:^|\.|-)(?:a|alpha|b|beta|rc|c|pre|dev)\d*/i.test(v)) return true;
  // Compact forms: 6.1a1, 2.0b1, 1.0rc2
  if (/^\d+(?:\.\d+)*[a-z]\d+/i.test(v)) return true;
  return false;
}

/** Map common PEP 440 forms to strings semver can compare. */
function normalizePypiVersionForCompare(version: string): string | null {
  const v = version.trim();
  if (!v) return null;

  const direct = semver.valid(v);
  if (direct) return direct;

  const compact = v.match(/^(\d+(?:\.\d+)*)(a|b|rc|c)(\d+)$/i);
  if (compact) {
    const base = compact[1];
    const kind = compact[2].toLowerCase();
    const num = compact[3];
    const tag = kind === "c" ? "rc" : kind;
    const normalized = `${base}-${tag}.${num}`;
    return semver.valid(normalized) ?? semver.valid(semver.coerce(normalized) ?? "");
  }

  const coerced = semver.coerce(v);
  if (coerced && semver.valid(coerced.version)) return coerced.version;

  return null;
}

/** Descending PEP 440 order (newest first). */
export function comparePypiVersions(a: string, b: string): number {
  const va = normalizePypiVersionForCompare(a);
  const vb = normalizePypiVersionForCompare(b);
  if (va && vb) return semver.rcompare(va, vb);
  if (va && !vb) return -1;
  if (!va && vb) return 1;
  return b.localeCompare(a, undefined, { numeric: true });
}

export function sortPypiVersionsDesc(versions: string[]): string[] {
  return [...versions].sort(comparePypiVersions);
}

const PYPI_CLAUSE = /^(===|==|!=|<=|>=|~=|<|>)\s*(.+)$/;

type PypiClause = { op: string; version: string };

function parsePypiClauses(spec: string): PypiClause[] | null {
  const parts = spec
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const clauses: PypiClause[] = [];
  for (const part of parts) {
    const match = part.match(PYPI_CLAUSE);
    if (!match) return null;
    const version = match[2].trim();
    if (!version) return null;
    clauses.push({ op: match[1], version });
  }
  return clauses;
}

/** Lowest version a specifier still accepts. Upper bounds are ignored. */
function pypiSpecifierFloor(clauses: PypiClause[]): string | null {
  let floor: string | null = null;
  for (const clause of clauses) {
    if (clause.op === "!=" || clause.op === "<" || clause.op === "<=") continue;
    const version = clause.version.endsWith(".*")
      ? clause.version.slice(0, -2)
      : clause.version;
    if (!version) continue;
    if (!floor || comparePypiVersions(version, floor) < 0) floor = version;
  }
  return floor;
}

/**
 * True when the latest PyPI release is newer than the lowest version the
 * pasted specifier accepts. Same meaning as the npm paste check.
 */
export function isPypiUpdateAvailable(
  requested: string | undefined,
  latest: string | undefined,
): boolean {
  if (!requested || !latest || latest === "Unknown") return false;
  const spec = requested.trim();
  if (!spec || spec === "*") return false;
  const clauses = parsePypiClauses(spec);
  const floor = clauses ? pypiSpecifierFloor(clauses) : spec;
  if (!floor) return false;
  return comparePypiVersions(latest, floor) < 0;
}

/** Short explanation of a PEP 440 specifier for the paste list. */
export function describePypiSpec(
  spec: string | undefined,
): { label: string; detail: string } | null {
  if (!spec?.trim()) return null;
  const clauses = parsePypiClauses(spec.trim());
  if (!clauses) return { label: "Spec", detail: spec.trim() };
  if (clauses.length === 1) {
    const clause = clauses[0];
    if (clause.op === "==" || clause.op === "===") {
      return { label: "Pinned", detail: `exact ${clause.version}` };
    }
    if (clause.op === "~=") {
      const floor = clause.version.endsWith(".*")
        ? clause.version.slice(0, -2)
        : clause.version;
      return { label: "Compatible (~=)", detail: `≥ ${floor}` };
    }
    if (clause.op === ">=" || clause.op === ">") {
      return { label: "Range", detail: `≥ ${clause.version}` };
    }
  }
  const floor = pypiSpecifierFloor(clauses);
  return {
    label: "Range",
    detail: floor ? `≥ ${floor}` : spec.trim(),
  };
}

export function listStablePypiVersions(
  versionTimes?: Record<string, string> | null,
): string[] {
  if (!versionTimes) return [];
  return sortPypiVersionsDesc(
    Object.keys(versionTimes).filter(
      (key) => !TIME_META.has(key) && !isPypiPrerelease(key),
    ),
  );
}
