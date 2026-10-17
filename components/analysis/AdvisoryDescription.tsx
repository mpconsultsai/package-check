"use client";

import Markdown from "react-markdown";
import type { Components } from "react-markdown";

const headingClass =
  "font-semibold text-ink mt-3 mb-1 first:mt-0";

const components: Components = {
  h1: ({ children }) => <h3 className={headingClass}>{children}</h3>,
  h2: ({ children }) => <h3 className={headingClass}>{children}</h3>,
  h3: ({ children }) => <h3 className={headingClass}>{children}</h3>,
  h4: ({ children }) => <h4 className={headingClass}>{children}</h4>,
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="link"
    >
      {children}
    </a>
  ),
  code: ({ children, className }) => {
    if (!className) {
      return (
        <code className="px-1 py-0.5 rounded bg-gray-200/80 dark:bg-gray-800 font-mono text-[0.85em]">
          {children}
        </code>
      );
    }
    return <code className="font-mono text-xs">{children}</code>;
  },
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-md bg-gray-100 dark:bg-gray-900 p-3 my-2 text-xs">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-gray-300 dark:border-gray-600 pl-3 my-2">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-rule" />,
};

export function AdvisoryDescription({ markdown }: { markdown: string }) {
  if (!markdown?.trim()) return null;

  return (
    <div className="text-sm text-gray-700 dark:text-gray-300 mt-2">
      <Markdown components={components}>{markdown}</Markdown>
    </div>
  );
}
