export function AppLogo({ className = "w-10 h-10" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width="32"
      height="32"
      className={`block ${className ?? ""}`.trim()}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="3" className="fill-ink" />
      <path
        fill="none"
        className="stroke-paper"
        strokeWidth="3.4"
        strokeLinecap="square"
        strokeLinejoin="miter"
        d="M8.5 16.5 13.5 21.5 23.5 10.5"
      />
      <rect x="23" y="23" width="5" height="5" className="fill-signal" />
    </svg>
  );
}
