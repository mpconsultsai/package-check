const CLOSE_EVENT = "pc:close-utility-panel";

/** Ask the search shell to collapse Watchlist / Paste / Settings. */
export function requestCloseShellUtilityPanel(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CLOSE_EVENT));
}

export function subscribeCloseShellUtilityPanel(
  listener: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener();
  window.addEventListener(CLOSE_EVENT, handler);
  return () => window.removeEventListener(CLOSE_EVENT, handler);
}
