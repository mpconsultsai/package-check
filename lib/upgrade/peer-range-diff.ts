import semver from "semver";

/** Split an npm peer range on top-level `||` clauses. */
export function peerRangeParts(range: string): string[] {
  return range
    .split(/\s*\|\|\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function rangesIntersect(left: string, right: string): boolean {
  try {
    return semver.intersects(left, right, { includePrerelease: true });
  } catch {
    return false;
  }
}

function rangeIsSubset(inner: string, outer: string): boolean {
  try {
    return semver.subset(inner, outer, { includePrerelease: true });
  } catch {
    return false;
  }
}

/** Clauses present in `from` that no longer intersect `to`. */
export function droppedPeerRangeParts(from: string, to: string): string[] {
  return peerRangeParts(from).filter((part) => !rangesIntersect(part, to));
}

/** Clauses present in `to` that did not intersect `from`. */
export function addedPeerRangeParts(from: string, to: string): string[] {
  return peerRangeParts(to).filter((part) => !rangesIntersect(part, from));
}

/**
 * Short human label for a clause — `^15.2.0` → `15.x`.
 * Helps call out dropped major lines without restating the full range.
 */
export function peerRangePartLabel(part: string): string {
  const trimmed = part.trim();
  const version = semver.coerce(trimmed);
  if (!version) return trimmed;
  if (/^\^/.test(trimmed)) return `${version.major}.x`;
  if (/^~/.test(trimmed)) return `${version.major}.${version.minor}.x`;
  if (/^>=?\d/.test(trimmed.replace(/\s+/g, ""))) {
    return `${version.major}+`;
  }
  return trimmed;
}

export type PeerRangeChangeSummary = {
  dropped: string[];
  added: string[];
  narrowed: boolean;
  /** One-line summary for briefs / UI, without repeating the package name. */
  detail: string;
};

/**
 * Explain what a peer range change means — especially dropped OR-clauses
 * like `^15.2.0` vanishing from `^15.2.0 || ^16 || ^17`.
 */
export function summarizePeerRangeChange(
  from: string,
  to: string,
): PeerRangeChangeSummary {
  const dropped = droppedPeerRangeParts(from, to);
  const added = addedPeerRangeParts(from, to);
  const narrowed =
    dropped.length === 0 &&
    added.length === 0 &&
    from.trim() !== to.trim() &&
    rangeIsSubset(to, from) &&
    !rangeIsSubset(from, to);

  const bits: string[] = [];
  if (dropped.length > 0) {
    const majors = [...new Set(dropped.map(peerRangePartLabel))];
    bits.push(
      `drops ${dropped.join(", ")} (${majors.join(", ")} no longer accepted)`,
    );
  }
  if (added.length > 0) {
    bits.push(`adds ${added.join(", ")}`);
  }
  if (narrowed) {
    bits.push(`narrowed ${from} → ${to}`);
  }

  const detail =
    bits.length > 0
      ? `${bits.join("; ")} — now ${to}`
      : `${from} → ${to}`;

  return { dropped, added, narrowed, detail };
}

/** Format a peer change for agent briefs and next-step lists. */
export function formatPeerChangeLine(change: {
  kind: string;
  name: string;
  range?: string;
  from?: string;
  to?: string;
}): string {
  const name = change.name.trim();
  if (!name) return "";
  if (change.kind === "added") {
    return `${name} (new peer: ${change.range ?? change.to ?? "?"})`;
  }
  if (change.kind === "removed") {
    return `${name} (removed peer: ${change.range ?? change.from ?? "?"})`;
  }
  if (change.kind === "changed" && change.from && change.to) {
    const summary = summarizePeerRangeChange(change.from, change.to);
    return `${name}: ${summary.detail}`;
  }
  return name;
}
