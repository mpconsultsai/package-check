"use client";

import {
  aiScoreBarClass,
  aiScoreTextClass,
  isHighQualityAiScore,
  ratingTextClass,
  recommendationBadgeClass,
  recommendationLabel,
} from "@/lib/utils/ai-score";

interface AIAnalysis {
  summary: string;
  recommendation: string;
  overallScore: number;
  securityRating: string;
  qualityRating: string;
  maintenanceRating: string;
  strengths?: string[];
  concerns?: string[];
  reasoning?: string;
  model?: string;
}

interface AIAnalysisCardProps {
  ai: AIAnalysis;
}

const RATINGS = [
  { key: "securityRating" as const, label: "Security" },
  { key: "qualityRating" as const, label: "Quality" },
  { key: "maintenanceRating" as const, label: "Maintenance" },
];

export function AIAnalysisCard({ ai }: AIAnalysisCardProps) {
  const score = Math.min(100, Math.max(0, ai.overallScore));
  const label = recommendationLabel(ai.recommendation);
  const strengths = (ai.strengths ?? []).map((item) => item.trim()).filter(Boolean);
  const concerns = (ai.concerns ?? [])
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && !isPlaceholderNote(item));
  const reasoning = ai.reasoning?.trim() ?? "";
  const summary = ai.summary?.trim() ?? "";

  return (
    <div className="rounded-lg bg-white p-4 shadow-lg dark:bg-gray-800 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-rule pb-4">
        <span
          className={`inline-flex shrink-0 -rotate-1 items-center border-2 px-2.5 py-1 font-mono text-sm font-semibold uppercase tracking-[0.1em] ${recommendationBadgeClass(ai.recommendation)}`}
        >
          {label}
        </span>
        <div className="flex min-w-0 items-end gap-4">
          <p className="inline-flex items-baseline gap-1 font-mono">
            <span className="sr-only">Overall score</span>
            <span
              className={`text-4xl font-semibold tabular-nums leading-none sm:text-5xl ${aiScoreTextClass(score)}`}
            >
              {score}
            </span>
            <span className="text-base text-gray-500 tabular-nums dark:text-gray-400">
              /100
            </span>
            {isHighQualityAiScore(score) && (
              <span className="sr-only">High-quality package</span>
            )}
          </p>
          <div
            className="mb-1.5 hidden h-1.5 w-32 bg-gray-200 sm:block dark:bg-gray-700"
            role="meter"
            aria-label="Overall score"
            aria-valuenow={score}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={`${aiScoreBarClass(score)} h-full transition-[width] duration-500`}
              style={{ width: `${score}%` }}
            />
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-3 divide-x divide-rule border-b border-rule">
        {RATINGS.map((item, index) => {
          const value = ai[item.key];
          return (
            <div
              key={item.key}
              className={`py-3 ${index === 0 ? "pr-3" : "px-3"}`}
            >
              <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">
                {item.label}
              </dt>
              <dd
                className={`mt-0.5 font-semibold capitalize ${ratingTextClass(value)}`}
              >
                {value}
              </dd>
            </div>
          );
        })}
      </dl>

      {(summary || reasoning) && (
        <div className="grid gap-5 border-b border-rule py-5 md:grid-cols-[1fr_16rem] md:gap-8">
          {summary && (
            <p className="max-w-prose text-[0.9375rem] leading-relaxed text-gray-700 dark:text-gray-300">
              {summary}
            </p>
          )}
          {reasoning && (
            <aside className="border-l-2 border-signal pl-4">
              <p className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">
                Model&rsquo;s note
              </p>
              <p className="text-sm leading-relaxed text-ink">{reasoning}</p>
            </aside>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 pt-5 md:grid-cols-2 md:gap-8">
        <PointList
          title="In its favour"
          tone="green"
          items={strengths}
          empty="None noted."
        />
        <PointList
          title="Watch out for"
          tone="amber"
          items={concerns}
          empty="None noted."
        />
      </div>
    </div>
  );
}

function PointList({
  title,
  tone,
  items,
  empty,
}: {
  title: string;
  tone: "green" | "amber";
  items: string[];
  empty: string;
}) {
  const markClass =
    tone === "green"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-amber-600 dark:text-amber-400";
  const mark = tone === "green" ? "+" : "−";

  return (
    <section className="min-w-0">
      <h3 className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">
        {title}
      </h3>
      {items.length > 0 ? (
        <ul className="space-y-2 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
          {items.map((item, index) => (
            <li key={`${index}-${item}`} className="grid grid-cols-[1rem_1fr] gap-1">
              <span
                className={`font-mono font-semibold ${markClass}`}
                aria-hidden="true"
              >
                {mark}
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">{empty}</p>
      )}
    </section>
  );
}

function isPlaceholderNote(value: string): boolean {
  return /^(none|n\/a|no concerns?|nothing notable)\.?$/i.test(value);
}
