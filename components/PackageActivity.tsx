"use client";

import Link from "next/link";
import { useShellEcosystem } from "@/components/shell-ecosystem";
import type { ActivePackage, PackageActivity as Activity } from "@/lib/db/package-activity";
import { packagePagePath, type PackageEcosystem } from "@/lib/packages/package-routes";

function ActivityList({
  title,
  items,
  ecosystem,
  showCounts,
}: {
  title: string;
  items: ActivePackage[];
  ecosystem: PackageEcosystem;
  showCounts: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-gray-600 dark:text-gray-400">
        {title}
      </h2>
      <ol className="mt-2 divide-y divide-rule border-y border-rule">
        {items.map((item) => (
          <li
            key={item.name}
            className="flex items-baseline justify-between gap-3 py-2"
          >
            <Link
              href={packagePagePath(ecosystem, item.name)}
              scroll={false}
              className="link min-w-0 truncate font-mono text-sm"
            >
              {item.name}
            </Link>
            {showCounts && (
              <span className="shrink-0 font-mono text-xs tabular-nums text-gray-600 dark:text-gray-400">
                {item.checks} {item.checks === 1 ? "check" : "checks"}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function PackageActivity({ activity }: { activity: Activity }) {
  const ecosystem = useShellEcosystem();
  const { popular, recent } = activity[ecosystem];
  if (popular.length === 0 && recent.length === 0) return null;
  const popularNames = new Set(popular.map((item) => item.name));
  const recentAddsNothing = recent.every((item) => popularNames.has(item.name));

  return (
    <section
      aria-label="Package activity"
      className="mb-10 grid gap-8 sm:grid-cols-2 sm:gap-10"
    >
      <ActivityList
        title="Most checked this week"
        items={popular}
        ecosystem={ecosystem}
        showCounts
      />
      <ActivityList
        title="Recently checked"
        items={recentAddsNothing ? [] : recent}
        ecosystem={ecosystem}
        showCounts={false}
      />
    </section>
  );
}
