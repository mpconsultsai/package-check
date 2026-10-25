"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type AnnouncePoliteness = "polite" | "assertive";

export type AnnounceOptions = {
  politeness?: AnnouncePoliteness;
};

export type AnnounceFn = (message: string, options?: AnnounceOptions) => void;

const AnnounceContext = createContext<AnnounceFn | null>(null);

const REANNOUNCE_MS = 50;

/**
 * Always-mounted polite and assertive live regions. Prefer this over mounting
 * a new aria-live node with the message: VoiceOver often misses that pattern.
 */
export function LiveAnnouncerProvider({ children }: { children: ReactNode }) {
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  const politeToken = useRef(0);
  const assertiveToken = useRef(0);
  const politeTimer = useRef<number | null>(null);
  const assertiveTimer = useRef<number | null>(null);

  const announce = useCallback((message: string, options?: AnnounceOptions) => {
    const text = message.trim();
    if (!text) return;

    const politeness = options?.politeness ?? "polite";
    const setMessage = politeness === "assertive" ? setAssertive : setPolite;
    const tokenRef = politeness === "assertive" ? assertiveToken : politeToken;
    const timerRef = politeness === "assertive" ? assertiveTimer : politeTimer;

    tokenRef.current += 1;
    const token = tokenRef.current;
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // Clear first so the same message can be announced again.
    setMessage("");
    timerRef.current = window.setTimeout(() => {
      if (tokenRef.current !== token) return;
      setMessage(text);
      timerRef.current = null;
    }, REANNOUNCE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (politeTimer.current != null) window.clearTimeout(politeTimer.current);
      if (assertiveTimer.current != null) {
        window.clearTimeout(assertiveTimer.current);
      }
    };
  }, []);

  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
    </AnnounceContext.Provider>
  );
}

/** Announce a status or error. No-ops outside LiveAnnouncerProvider. */
export function useAnnounce(): AnnounceFn {
  const announce = useContext(AnnounceContext);
  return announce ?? (() => {});
}

/**
 * Announce whenever `message` becomes a non-empty string. Use for discrete
 * status lines (errors, "searching…"), not for high-frequency progress text.
 */
export function useLiveMessage(
  message: string | null | undefined,
  options?: AnnounceOptions & { enabled?: boolean },
) {
  const announce = useAnnounce();
  const politeness = options?.politeness ?? "polite";
  const enabled = options?.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;
    const text = message?.trim();
    if (!text) return;
    announce(text, { politeness });
  }, [announce, enabled, message, politeness]);
}
