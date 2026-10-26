const MS_PER_DAY = 1000 * 60 * 60 * 24;
/** Package age under this many days is called out. */
export const YOUNG_PACKAGE_DAYS = 90;
const TIME_META = new Set(["created", "modified", "unpublished"]);

export type NpmPublishRisk = {
  /** Compact notes for the Maintainers fact. Empty when nothing stands out. */
  notes: string[];
  packageAgeDays: number | null;
  maintainerCount: number;
  publisherName: string | null;
  newPublisher: boolean;
};

function packageAgeDays(
  createdAt: string | null | undefined,
  now: number,
): number | null {
  if (!createdAt) return null;
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return null;
  return Math.max(0, Math.floor((now - created) / MS_PER_DAY));
}

function publisherOf(version: {
  _npmUser?: { name?: string | null } | null;
}): string | null {
  const name = version._npmUser?.name?.trim();
  return name || null;
}

/**
 * Publish-side signals from the packument: young package, solo maintainer,
 * and a first-time publisher on this package. Caps at two notes.
 */
export function assessNpmPublishRisk(options: {
  createdAt?: string | null;
  maintainers?: Array<{ name?: string | null } | null> | null;
  latestVersion: string;
  versions?: Record<
    string,
    { _npmUser?: { name?: string | null } | null } | undefined
  > | null;
  versionTimes?: Record<string, string> | null;
  now?: number | Date;
}): NpmPublishRisk {
  const now =
    options.now instanceof Date
      ? options.now.getTime()
      : typeof options.now === "number"
        ? options.now
        : Date.now();

  const ageDays = packageAgeDays(options.createdAt, now);
  const maintainerNames = new Set<string>();
  for (const maintainer of options.maintainers ?? []) {
    const name = maintainer?.name?.trim();
    if (name) maintainerNames.add(name.toLowerCase());
  }
  const maintainerCount = maintainerNames.size;

  const latest = options.latestVersion.trim();
  const publisherName = latest
    ? publisherOf(options.versions?.[latest] ?? {})
    : null;

  let newPublisher = false;
  if (publisherName && options.versions && options.versionTimes) {
    const times = options.versionTimes;
    const earlier = Object.keys(options.versions).filter((version) => {
      if (version === latest || TIME_META.has(version)) return false;
      if (!times[version]) return false;
      const published = new Date(times[version]!).getTime();
      const latestPublished = times[latest]
        ? new Date(times[latest]!).getTime()
        : NaN;
      if (Number.isNaN(published) || Number.isNaN(latestPublished)) return false;
      return published < latestPublished;
    });
    if (earlier.length > 0) {
      const seenBefore = earlier.some(
        (version) =>
          publisherOf(options.versions?.[version] ?? {})?.toLowerCase() ===
          publisherName.toLowerCase(),
      );
      newPublisher = !seenBefore;
    }
  }

  const notes: string[] = [];
  if (ageDays !== null && ageDays < YOUNG_PACKAGE_DAYS) {
    notes.push(
      ageDays === 0
        ? "Package created today."
        : ageDays === 1
          ? "Package created 1 day ago."
          : `Package created ${ageDays} days ago.`,
    );
  }
  if (maintainerCount === 1) {
    notes.push("Single maintainer.");
  }
  if (newPublisher && publisherName && notes.length < 2) {
    notes.push(`First publish by ${publisherName} on this package.`);
  }

  return {
    notes: notes.slice(0, 2),
    packageAgeDays: ageDays,
    maintainerCount,
    publisherName,
    newPublisher,
  };
}
