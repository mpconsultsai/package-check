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

/** Move the window to the top. Skips the animation when the reader prefers reduced motion. */
export function scrollToTop() {
  if (typeof window === "undefined" || window.scrollY <= 0) return;
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  window.scrollTo({
    top: 0,
    behavior: reduceMotion ? "auto" : "smooth",
  });
}
