"use client";

import { useShellEcosystem } from "@/components/shell-ecosystem";
import { featuresForEcosystem } from "@/lib/packages/ecosystem-features";
import { registryLabel, type PackageEcosystem } from "@/lib/packages/package-routes";

type Check = { term: string; detail: string };

function checksFor(ecosystem: PackageEcosystem): Check[] {
  const features = featuresForEcosystem(ecosystem);
  const checks: Check[] = [
    {
      term: "Advisories",
      detail:
        "Known vulnerabilities from the GitHub Advisory Database, matched against the exact version you pick.",
    },
    {
      term: "Upkeep",
      detail:
        "When it was last published, how often it ships, open issues, and the OpenSSF Scorecard where one exists.",
    },
    {
      term: "Dependencies",
      detail: features.transitiveDepsTree
        ? "The direct and transitive tree, including which direct dependencies have known advisories."
        : "What it depends on directly, before you add it to your project.",
    },
    {
      term: "History",
      detail: features.downloadCharts
        ? "Downloads, releases and issue activity over time."
        : "Releases and issue activity over time.",
    },
  ];
  if (features.upgradeAdvisor) {
    checks.push({
      term: "Upgrade path",
      detail:
        "What changes between your version and the latest, including breaking changes and fixed advisories.",
    });
  }
  if (features.relatedPackages) {
    checks.push({
      term: "Alternatives",
      detail:
        "Competing packages compared on quality, vulnerabilities, downloads and last release.",
    });
  }
  checks.push({
    term: "Second opinion",
    detail:
      "An optional AI read of the figures above. Treat it as a note in the margin, not a verdict.",
  });
  return checks;
}

export function WhatWeCheck({ level = 2 }: { level?: 1 | 2 }) {
  const ecosystem = useShellEcosystem();
  const checks = checksFor(ecosystem);
  const Heading = level === 1 ? "h1" : "h2";

  return (
    <section
      aria-labelledby="what-we-check-heading"
      className="border-t-2 border-ink pt-4"
    >
      <Heading
        id="what-we-check-heading"
        className="font-mono text-xs uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400"
      >
        What gets checked for {registryLabel(ecosystem)} packages
      </Heading>
      <dl className="mt-2 divide-y divide-rule border-b border-rule">
        {checks.map((item, index) => (
          <div
            key={item.term}
            className="grid grid-cols-[2.25rem_1fr] gap-x-3 py-3.5 sm:grid-cols-[2.5rem_11rem_1fr] sm:gap-x-4"
          >
            <span
              className="font-mono text-sm text-signal tabular-nums"
              aria-hidden="true"
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <dt className="font-semibold text-ink">{item.term}</dt>
            <dd className="col-start-2 text-[0.9375rem] leading-relaxed text-gray-600 sm:col-start-3 dark:text-gray-400">
              {item.detail}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
