/** Crossfade client navigations when the View Transitions API is available. */
export function smoothNavigate(update: () => void) {
  if (typeof document === "undefined") {
    update();
    return;
  }

  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => unknown;
  };

  if (!reduceMotion && typeof doc.startViewTransition === "function") {
    doc.startViewTransition(update);
    return;
  }

  update();
}
