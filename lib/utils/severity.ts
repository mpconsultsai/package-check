const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  moderate: 2,
  medium: 2,
  low: 3,
};

export function sortBySeverity<T extends { severity: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aRank = SEVERITY_RANK[a.severity.toLowerCase()] ?? 9;
    const bRank = SEVERITY_RANK[b.severity.toLowerCase()] ?? 9;
    return aRank - bRank;
  });
}

/** Background + text - low uses dark text for WCAG contrast on yellow. */
export function severityBadgeClass(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical":
      return "bg-purple-500 text-white";
    case "high":
      return "bg-red-500 text-white";
    case "moderate":
    case "medium":
      return "bg-orange-600 text-white";
    default:
      return "bg-yellow-400 text-yellow-950";
  }
}

export function severityBorderClass(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical":
      return "border-purple-500";
    case "high":
      return "border-red-500";
    case "moderate":
    case "medium":
      return "border-orange-500";
    default:
      return "border-yellow-500";
  }
}
