import {
  PACKAGE_ECOSYSTEMS,
  type PackageEcosystem,
} from "@/lib/packages/package-routes";

const LIST_LIMIT = 5;
const NAME_MAX = 100;
/** npm/PyPI/NuGet names, plus Maven groupId:artifactId. */
const PACKAGE_NAME =
  /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?::[a-z0-9][\w.-]*)?$/i;

export type ActivePackage = { name: string; checks: number };

export type EcosystemActivity = {
  popular: ActivePackage[];
  recent: ActivePackage[];
};

export type PackageActivity = Record<PackageEcosystem, EcosystemActivity>;

export type PackageActivityRow = {
  ecosystem: unknown;
  name: unknown;
  checks: unknown;
  last_checked: unknown;
};

export const createEmptyPackageActivity = (): PackageActivity => {
  const activity = {} as PackageActivity;
  for (const ecosystem of PACKAGE_ECOSYSTEMS) {
    activity[ecosystem] = { popular: [], recent: [] };
  }
  return activity;
};

const isEcosystem = (value: unknown): value is PackageEcosystem =>
  typeof value === "string" &&
  (PACKAGE_ECOSYSTEMS as readonly string[]).includes(value);

const timestamp = (value: unknown): number => {
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(time) ? time : 0;
};

/** Most checked and most recently checked packages per registry. */
export const groupPackageActivity = (
  rows: PackageActivityRow[],
): PackageActivity => {
  const byEcosystem = new Map<
    PackageEcosystem,
    { name: string; checks: number; last: number }[]
  >();
  for (const row of rows) {
    if (!isEcosystem(row.ecosystem) || typeof row.name !== "string") continue;
    const name = row.name.trim();
    if (name.length < 2 || name.length > NAME_MAX || !PACKAGE_NAME.test(name)) {
      continue;
    }
    const checks = Number(row.checks);
    if (!Number.isFinite(checks) || checks < 1) continue;
    const list = byEcosystem.get(row.ecosystem) ?? [];
    list.push({ name, checks, last: timestamp(row.last_checked) });
    byEcosystem.set(row.ecosystem, list);
  }

  const activity = createEmptyPackageActivity();
  for (const [ecosystem, list] of byEcosystem) {
    const strip = ({ name, checks }: { name: string; checks: number }) => ({
      name,
      checks,
    });
    activity[ecosystem] = {
      popular: [...list]
        .sort((a, b) => b.checks - a.checks || b.last - a.last || a.name.localeCompare(b.name))
        .slice(0, LIST_LIMIT)
        .map(strip),
      recent: [...list]
        .sort((a, b) => b.last - a.last || a.name.localeCompare(b.name))
        .slice(0, LIST_LIMIT)
        .map(strip),
    };
  }
  return activity;
};
