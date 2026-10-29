"use client";

import { type ReactNode } from "react";

const URL_RE = /(https?:\/\/[^\s<>"']+)/g;

function splitTrailingPunctuation(raw: string): {
  href: string;
  trailing: string;
} {
  let href = raw;
  let trailing = "";
  while (href.length > 0 && /[.,;:!?)\]}'"]$/.test(href)) {
    trailing = href.slice(-1) + trailing;
    href = href.slice(0, -1);
  }
  return { href, trailing };
}

function compactUrlLabel(href: string): string {
  try {
    const url = new URL(href);
    const path =
      url.pathname.length > 36
        ? `…${url.pathname.slice(-28)}`
        : url.pathname === "/"
          ? ""
          : url.pathname;
    return `${url.hostname}${path}`;
  } catch {
    return href;
  }
}

/** Render plain text with http(s) URLs as external links. */
export function LinkifiedText({
  text,
  className = "link break-all",
  compactLinks = false,
}: {
  text: string;
  className?: string;
  /** Show hostname + short path instead of the full URL. */
  compactLinks?: boolean;
}): ReactNode {
  if (!text) return null;

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(URL_RE.source, "g");

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const { href, trailing } = splitTrailingPunctuation(match[1]);
    if (href) {
      parts.push(
        <a
          key={`${href}-${match.index}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={className}
          title={compactLinks ? href : undefined}
        >
          {compactLinks ? compactUrlLabel(href) : href}
        </a>,
      );
    }
    if (trailing) parts.push(trailing);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : <>{parts}</>;
}
