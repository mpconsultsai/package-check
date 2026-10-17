"use client";

import Link from "next/link";
import { formatBytes, formatCompactNumber } from "@/lib/utils/format";
import type { CompareColumn } from "@/lib/packages/package-compare";
import {
  packagePagePath,
  type PackageEcosystem,
} from "@/lib/packages/package-routes";

const Pulse = () => (
  <span
    className="inline-block h-4 w-14 rounded bg-gray-200 dark:bg-gray-700 animate-pulse"
    aria-hidden="true"
  />
);

const cellValue = (
  column: CompareColumn,
  render: (column: CompareColumn) => string | null | undefined,
  rowKey: string,
): string | null => {
  if (column.status === "loading") return null;
  if (column.status === "error") {
    return rowKey === "version" ? column.error || "Unavailable" : null;
  }
  const value = render(column);
  return value == null || value === "" ? null : value;
};

const rows: {
  key: string;
  label: string;
  render: (column: CompareColumn) => string | null | undefined;
}[] = [
  {
    key: "version",
    label: "Version",
    render: (c) => (c.version ? `v${c.version}` : null),
  },
  {
    key: "quality",
    label: "Quality",
    render: (c) =>
      typeof c.qualityScore === "number" ? `${c.qualityScore}/100` : null,
  },
  {
    key: "vulns",
    label: "Vulnerabilities",
    render: (c) =>
      typeof c.vulnerabilityCount === "number"
        ? String(c.vulnerabilityCount)
        : null,
  },
  {
    key: "downloads",
    label: "Downloads (month)",
    render: (c) =>
      typeof c.downloads === "number"
        ? formatCompactNumber(c.downloads)
        : null,
  },
  {
    key: "bundle",
    label: "Bundle (gzip)",
    render: (c) =>
      typeof c.bundleGzip === "number" ? formatBytes(c.bundleGzip) : null,
  },
  {
    key: "lastRelease",
    label: "Last release",
    render: (c) => c.lastRelease,
  },
  {
    key: "licence",
    label: "Licence",
    render: (c) => c.license,
  },
];

export function PackageCompareTable({
  columns,
  ecosystem = "npm",
  onClear,
}: {
  columns: CompareColumn[];
  ecosystem?: PackageEcosystem;
  onClear: () => void;
}) {
  const visibleRows = rows.filter((row) =>
    columns.some((column) => {
      if (column.status === "loading") return true;
      return cellValue(column, row.render, row.key) != null;
    }),
  );

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 sm:p-6">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
          Compare
        </p>
        <button
          type="button"
          onClick={onClear}
          className="link text-xs"
        >
          Clear comparison
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-rule">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            <tr>
              <th className="sticky left-0 z-20 bg-gray-50 dark:bg-gray-900 px-3 py-2 font-semibold min-w-[7.5rem]">
                <span className="sr-only">Metric</span>
              </th>
              {columns.map((column, index) => (
                <th
                  key={column.name}
                  className="px-3 py-2 font-semibold min-w-[8rem] normal-case tracking-normal"
                >
                  <Link
                    href={packagePagePath(ecosystem, column.name)}
                    className="link"
                  >
                    {column.name}
                  </Link>
                  {index === 0 && (
                    <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">
                      Current
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {visibleRows.map((row) => (
              <tr key={row.key} className="bg-white dark:bg-gray-800">
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-white dark:bg-gray-800 px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap"
                >
                  {row.label}
                </th>
                {columns.map((column) => {
                  if (column.status === "loading") {
                    return (
                      <td key={column.name} className="px-3 py-2">
                        <Pulse />
                      </td>
                    );
                  }
                  const value = cellValue(column, row.render, row.key);
                  return (
                    <td
                      key={column.name}
                      className="px-3 py-2 text-ink tabular-nums"
                    >
                      {value ?? "-"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
