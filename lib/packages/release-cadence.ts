/**
 * Build release history series from the npm packument `time` map.
 */

import semver from "semver";

const META_KEYS = new Set(["created", "modified", "unpublished"]);

export interface ReleaseCadencePoint {
  /** First day of month, YYYY-MM-DD */
  date: string;
  value: number;
}

export interface ReleaseTypeMixPoint {
  date: string;
  major: number;
  minor: number;
  patch: number;
}

export interface ReleaseTypeMixResult {
  points: ReleaseTypeMixPoint[];
  totals: { major: number; minor: number; patch: number; all: number };
  /** Most recent major bumps in the window (newest first) */
  recentMajors: { version: string; date: string }[];
}

const monthKey = (d: Date): string => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
};

const addMonths = (d: Date, n: number): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));

const monthsBetween = (start: Date, end: Date): Date[] => {
  const count =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth()) +
    1;
  return Array.from({ length: Math.max(0, count) }, (_, i) => addMonths(start, i));
};

type BumpKind = "major" | "minor" | "patch";

const classifyBump = (previous: string | null, next: string): BumpKind | null => {
  const cleaned = semver.valid(next);
  if (!cleaned || semver.prerelease(cleaned)) return null;

  if (!previous) {
    const parsed = semver.parse(cleaned);
    if (!parsed) return null;
    if (parsed.minor === 0 && parsed.patch === 0) return "major";
    if (parsed.patch === 0) return "minor";
    return "patch";
  }

  const diff = semver.diff(previous, cleaned);
  if (!diff) return null;
  if (diff === "major" || diff === "premajor") return "major";
  if (diff === "minor" || diff === "preminor") return "minor";
  return "patch";
};

/**
 * @param time npm `time` object (version → ISO date)
 * @param maxMonths cap the window to the most recent N months (default 36)
 */
export const buildReleaseCadence = (
  time?: Record<string, string> | null,
  maxMonths = 36,
): ReleaseCadencePoint[] => {
  if (!time) return [];

  const published = Object.entries(time)
    .filter(([key]) => !META_KEYS.has(key))
    .map(([, iso]) => new Date(iso))
    .filter((d) => !Number.isNaN(d.getTime()));

  if (published.length === 0) return [];

  const counts = published.reduce((acc, d) => {
    const mk = monthKey(d);
    acc.set(mk, (acc.get(mk) || 0) + 1);
    return acc;
  }, new Map<string, number>());

  const earliest = published.reduce((min, d) => (d < min ? d : min));
  const latest = published.reduce((max, d) => (d > max ? d : max));

  const end = new Date(
    Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth(), 1),
  );
  const windowStart = addMonths(end, -(maxMonths - 1));
  const startCandidate = new Date(
    Date.UTC(earliest.getUTCFullYear(), earliest.getUTCMonth(), 1),
  );
  const start = startCandidate < windowStart ? windowStart : startCandidate;

  return monthsBetween(start, end).map((cur) => {
    const date = monthKey(cur);
    return { date, value: counts.get(date) || 0 };
  });
};

/**
 * Monthly stacked major / minor / patch bumps (stable releases only).
 * Helps judge API churn when choosing a package.
 */
export const buildReleaseTypeMix = (
  time?: Record<string, string> | null,
  maxMonths = 36,
): ReleaseTypeMixResult => {
  const empty: ReleaseTypeMixResult = {
    points: [],
    totals: { major: 0, minor: 0, patch: 0, all: 0 },
    recentMajors: [],
  };
  if (!time) return empty;

  const events = Object.entries(time)
    .filter(
      ([key]) =>
        !META_KEYS.has(key) &&
        semver.valid(key) &&
        !semver.prerelease(key) &&
        !semver.eq(key, "0.0.0"),
    )
    .map(([version, iso]) => ({ version, at: new Date(iso) }))
    .filter((event) => !Number.isNaN(event.at.getTime()))
    .sort((a, b) => semver.compare(a.version, b.version));

  if (events.length === 0) return empty;

  const latestPublish = events.reduce(
    (max, e) => (e.at > max ? e.at : max),
    events[0].at,
  );
  const endMonth = new Date(
    Date.UTC(latestPublish.getUTCFullYear(), latestPublish.getUTCMonth(), 1),
  );
  const windowStart = addMonths(endMonth, -(maxMonths - 1));

  const classified = events.reduce<{
    previous: string | null;
    items: { version: string; at: Date; kind: BumpKind }[];
  }>(
    (acc, event) => {
      const kind = classifyBump(acc.previous, event.version);
      if (kind) acc.items.push({ ...event, kind });
      acc.previous = event.version;
      return acc;
    },
    { previous: null, items: [] },
  ).items;

  const inWindow = classified.filter((event) => {
    const monthStart = new Date(
      Date.UTC(event.at.getUTCFullYear(), event.at.getUTCMonth(), 1),
    );
    return monthStart >= windowStart;
  });

  if (inWindow.length === 0) return empty;

  const { monthBuckets, totals, majorsInWindow } = inWindow.reduce(
    (acc, event) => {
      const key = monthKey(event.at);
      const bucket = acc.monthBuckets.get(key) ?? {
        major: 0,
        minor: 0,
        patch: 0,
      };
      bucket[event.kind] += 1;
      acc.monthBuckets.set(key, bucket);
      acc.totals[event.kind] += 1;
      acc.totals.all += 1;
      if (event.kind === "major") {
        acc.majorsInWindow.push({
          version: event.version,
          date: event.at.toISOString(),
        });
      }
      return acc;
    },
    {
      monthBuckets: new Map<
        string,
        { major: number; minor: number; patch: number }
      >(),
      totals: { major: 0, minor: 0, patch: 0, all: 0 },
      majorsInWindow: [] as { version: string; date: string }[],
    },
  );

  const firstInView = [...monthBuckets.keys()].sort()[0];
  const start = (() => {
    if (!firstInView) return windowStart;
    const [y, m] = firstInView.split("-").map(Number);
    const firstMonth = new Date(Date.UTC(y, m - 1, 1));
    return firstMonth > windowStart ? firstMonth : windowStart;
  })();

  return {
    points: monthsBetween(start, endMonth).map((cur) => {
      const key = monthKey(cur);
      const bucket = monthBuckets.get(key) ?? { major: 0, minor: 0, patch: 0 };
      return { date: key, ...bucket };
    }),
    totals,
    recentMajors: majorsInWindow
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5),
  };
};
