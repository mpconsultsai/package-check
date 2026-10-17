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
