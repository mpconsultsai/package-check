/** Shared colour bands for AI / overall quality scores (0–100). */

export function aiScoreTextClass(score: number): string {
  if (score < 20) return "text-red-600 dark:text-red-400";
  if (score < 50) return "text-orange-600 dark:text-orange-400";
  if (score < 70) return "text-amber-600 dark:text-amber-400";
  if (score < 90) return "text-blue-600 dark:text-blue-400";
  return "text-emerald-600 dark:text-emerald-400";
}

export function aiScoreBarClass(score: number): string {
  if (score < 20) return "bg-red-500";
  if (score < 50) return "bg-orange-500";
  if (score < 70) return "bg-amber-500";
  if (score < 90) return "bg-blue-500";
  return "bg-emerald-500";
}

export function isHighQualityAiScore(score: number): boolean {
  return score >= 90;
}

/** Visible recommendation label. The badge carries this; there is no separate heading. */
export function recommendationLabel(recommendation: string): string {
  const value = recommendation.toLowerCase().trim();
  if (value === "do-not-use" || value === "not-recommended") return "Do not use";
  if (value === "use-with-caution") return "Use with caution";
  if (value === "recommended") return "Recommended";
  return recommendation.replace(/-/g, " ");
}

export function ratingTextClass(rating: string): string {
  const value = rating.toLowerCase().trim();
  if (value === "excellent") return "text-emerald-700 dark:text-emerald-300";
  if (value === "good") return "text-blue-700 dark:text-blue-300";
  if (value === "fair") return "text-amber-700 dark:text-amber-300";
  return "text-red-700 dark:text-red-300";
}

/** Recommendation stamp colours aligned with the AI score palette. */
export function recommendationBadgeClass(recommendation: string): string {
  const value = recommendation.toLowerCase().trim();
  if (value === "recommended") {
    return "border-emerald-600 text-emerald-700 dark:border-emerald-400 dark:text-emerald-300";
  }
  if (value === "use-with-caution") {
    return "border-amber-600 text-amber-700 dark:border-amber-400 dark:text-amber-300";
  }
  // do-not-use, not-recommended, and anything else negative
  return "border-red-600 text-red-700 dark:border-red-400 dark:text-red-300";
}
