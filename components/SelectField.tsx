import type { SelectHTMLAttributes } from "react";

/** Native select with the chevron set in from the edge. */
export function SelectField({
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`select-field border border-gray-400 bg-transparent py-2 ps-3 text-sm text-ink focus:border-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:opacity-60 dark:border-gray-500 dark:bg-gray-700 ${className}`}
    />
  );
}
