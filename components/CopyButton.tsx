"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "@/components/icons";
import { useAnnounce } from "@/components/LiveAnnouncer";

export function CopyButton({
  value,
  label = "Copy",
  className = "",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const announce = useAnnounce();

  if (!value) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      announce("Copied to clipboard");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className={`shrink-0 rounded-md p-1 text-gray-500 hover:bg-gray-200/80 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100 ${className}`}
      title={copied ? "Copied" : label}
      aria-label={label}
    >
      {copied ? (
        <CheckIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <CopyIcon className="h-4 w-4" />
      )}
    </button>
  );
}
