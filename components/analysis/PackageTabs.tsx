"use client";

import type { KeyboardEvent, ReactNode } from "react";
import {
  SecuritySeverityBadges,
  type SecurityCountSummary,
} from "./SecuritySeverityBadges";
import { CopyButton } from "@/components/CopyButton";

/** Top row - package facts that load with analyse */
export type OverviewTabId = "info" | "charts" | "dependencies";
/** Bottom row - deeper review (AI is slowest) */
export type InsightTabId = "ai" | "security" | "related";

/** @deprecated Use OverviewTabId */
export type AnalysisTabId = OverviewTabId;
/** @deprecated Use InsightTabId */
export type DetailsTabId = InsightTabId;

type TabDef<T extends string> = {
  id: T;
  label: string;
  shortLabel: string;
  detail?: string;
};

/** Shared package title shown above all result tabs. */
export function PackageNameHeader({
  packageName,
  homepage,
}: {
  packageName: string;
  homepage?: string | null;
}) {
  if (!packageName) return null;

  const nameNode = homepage ? (
    <a
      href={homepage}
      target="_blank"
      rel="noopener noreferrer"
      className="text-ink underline decoration-gray-600 decoration-2 underline-offset-[6px] hover:decoration-signal dark:decoration-gray-400"
    >
      {packageName}
    </a>
  ) : (
    <span className="text-ink">{packageName}</span>
  );

  return (
    <h1 className="font-mono text-3xl font-semibold tracking-tight break-all sm:text-4xl">
      <span className="inline-flex min-w-0 items-center gap-2">
        {nameNode}
        <CopyButton value={packageName} label="Copy package name" />
      </span>
    </h1>
  );
}

export function AnalysisPanel({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section
      role="tabpanel"
      id={id}
      aria-labelledby={headingId}
      tabIndex={0}
      className="outline-none focus-visible:ring-2 focus-visible:ring-signal"
    >
      <h2 id={headingId} className="sr-only">
        {title}
      </h2>
      {children}
    </section>
  );
}

function TabRow<T extends string>({
  label,
  idPrefix,
  tabs,
  active,
  onChange,
  security,
}: {
  label: string;
  idPrefix: string;
  tabs: TabDef<T>[];
  active: T;
  onChange: (tab: T) => void;
  security?: SecurityCountSummary | null;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    if (buttons.length === 0) return;
    const current = buttons.findIndex((tab) => tab === document.activeElement);
    const index = current >= 0 ? current : tabs.findIndex((tab) => tab.id === active);
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % buttons.length;
    else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + buttons.length) % buttons.length;
    } else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = buttons.length - 1;
    else return;
    event.preventDefault();
    const next = buttons[nextIndex];
    const nextId = next?.dataset.tabId;
    if (nextId) onChange(nextId as T);
    next?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className="flex gap-5 border-b border-rule sm:gap-7"
    >
      {tabs.map((tab) => {
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            id={`${idPrefix}-tab-${tab.id}`}
            role="tab"
            data-tab-id={tab.id}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${tab.id}`}
            aria-label={tab.label}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={`-mb-px inline-flex min-w-0 items-center gap-2 border-b-2 pb-2 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-signal sm:text-[0.9375rem] ${
              selected
                ? "border-signal font-semibold text-ink"
                : "border-transparent font-medium text-gray-500 hover:text-ink dark:text-gray-400"
            }`}
          >
            <span className="truncate sm:hidden">{tab.shortLabel}</span>
            <span className="min-w-0 truncate hidden sm:inline">
              {tab.label}
              {tab.detail && (
                <span className="ml-2 hidden font-mono text-xs font-normal text-gray-500 lg:inline dark:text-gray-400">
                  {tab.detail}
                </span>
              )}
            </span>
            {tab.id === "security" && (
              <SecuritySeverityBadges security={security} size="tab" />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Top row: Package info, Charts, Dependencies */
export function OverviewTabs({
  active,
  onChange,
  showCharts = true,
  showDependencies = true,
}: {
  active: OverviewTabId;
  onChange: (tab: OverviewTabId) => void;
  showCharts?: boolean;
  showDependencies?: boolean;
}) {
  const tabs: TabDef<OverviewTabId>[] = [
    { id: "info", label: "Package info", shortLabel: "Package" },
    ...(showCharts
      ? [
          {
            id: "charts" as const,
            label: "Charts",
            shortLabel: "Charts",
          },
        ]
      : []),
    ...(showDependencies
      ? [
          {
            id: "dependencies" as const,
            label: "Dependencies",
            shortLabel: "Deps",
          },
        ]
      : []),
  ];

  return (
    <TabRow
      label="Package overview"
      idPrefix="overview"
      tabs={tabs}
      active={active}
      onChange={onChange}
    />
  );
}

/** Bottom row: AI analysis, Security, Related packages */
export function InsightTabs({
  active,
  onChange,
  aiModel,
  security,
  showAi = true,
  showRelated = true,
}: {
  active: InsightTabId;
  onChange: (tab: InsightTabId) => void;
  aiModel?: string;
  security?: SecurityCountSummary | null;
  showAi?: boolean;
  showRelated?: boolean;
}) {
  const tabs: TabDef<InsightTabId>[] = [
    ...(showAi
      ? [
          {
            id: "ai" as const,
            label: "AI analysis",
            shortLabel: "AI",
            detail: aiModel,
          },
        ]
      : []),
    {
      id: "security",
      label: "Version check",
      shortLabel: "Version",
    },
    ...(showRelated
      ? [
          {
            id: "related" as const,
            label: "Related packages",
            shortLabel: "Related",
          },
        ]
      : []),
  ];

  return (
    <TabRow
      label="Package insights"
      idPrefix="insights"
      tabs={tabs}
      active={active}
      onChange={onChange}
      security={security}
    />
  );
}

/** @deprecated Use OverviewTabs */
export const AnalysisTabs = OverviewTabs;
/** @deprecated Use InsightTabs */
export const DetailsTabs = InsightTabs;
