import { severityBadgeClass } from "@/lib/utils/severity";

export interface SecurityCountSummary {
  critical?: number;
  high?: number;
  moderate?: number;
  low?: number;
}

const SEVERITY_LEVELS = [
  { key: "critical" as const, label: "Critical" },
  { key: "high" as const, label: "High" },
  { key: "moderate" as const, label: "Moderate" },
  { key: "low" as const, label: "Low" },
];

function countFor(
  summary: SecurityCountSummary | null | undefined,
  key: (typeof SEVERITY_LEVELS)[number]["key"],
): number {
  const value = Number(summary?.[key]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function getVisibleSecurityCounts(
  summary: SecurityCountSummary | null | undefined,
) {
  return SEVERITY_LEVELS.map((level) => ({
    ...level,
    count: countFor(summary, level.key),
  })).filter((level) => level.count > 0);
}

interface SecuritySeverityBadgesProps {
  security?: SecurityCountSummary | null;
  size?: "tab" | "inline";
  className?: string;
}

export function SecuritySeverityBadges({
  security,
  size = "inline",
  className = "",
}: SecuritySeverityBadgesProps) {
  const levels = getVisibleSecurityCounts(security);
  if (levels.length === 0) return null;

  const isTab = size === "tab";

  return (
    <span
      className={`${
        isTab ? "hidden sm:inline-flex" : "inline-flex"
      } items-center gap-1 flex-shrink-0 ${className}`}
      aria-label={`${levels.map((l) => `${l.count} ${l.label.toLowerCase()}`).join(", ")} vulnerabilities`}
    >
      {levels.map((level) => {
        return (
          <span
            key={level.key}
            title={`${level.count} ${level.label}`}
            className={`inline-flex items-center justify-center rounded-sm font-mono font-semibold tabular-nums ${severityBadgeClass(level.key)} ${
              isTab
                ? "min-w-[1.125rem] h-[1.125rem] px-1 text-[10px] leading-none"
                : "min-w-[1.5rem] h-6 px-1.5 text-xs"
            } ${level.key === "critical" && isTab ? "animate-pulse" : ""}`}
          >
            {level.count}
          </span>
        );
      })}
    </span>
  );
}
