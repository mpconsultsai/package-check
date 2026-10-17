"use client";

import { SITE_NAME } from "@/lib/site/site-brand";

export function ServiceStartingNotice() {
  return (
    <div
      role="alert"
      className="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/30 sm:p-6"
    >
      <h2 className="text-base font-semibold text-amber-950 dark:text-amber-100">
        {SITE_NAME} is starting up
      </h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-amber-900 dark:text-amber-200">
        The host sleeps when the site is idle. Reload to wake it. This can
        take about half a minute.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-4 inline-flex items-center rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-paper hover:bg-signal"
      >
        Reload
      </button>
    </div>
  );
}
