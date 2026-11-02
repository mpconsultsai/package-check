/**
 * Many POMs append CI / upgrade / docs notes after the real summary.
 * Keep a short lead as the description; move the rest to a note.
 */
export function splitMavenDescription(text: string): {
  description: string;
  descriptionNote?: string;
} {
  const trimmed = text.trim();
  if (!trimmed) return { description: "" };

  const candidates: number[] = [];

  // Prefer the first sentence when the remainder looks like linked docs/CI notes.
  const firstSentenceEnd = trimmed.search(/[.!?]\s+/);
  if (firstSentenceEnd >= 40) {
    const rest = trimmed.slice(firstSentenceEnd + 1).trim();
    if (rest.length >= 40 && /https?:\/\//i.test(rest)) {
      candidates.push(firstSentenceEnd);
    }
  }

  const apacheTail = trimmed.search(
    /\.\s+(?=See https?:\/\/|Please ensure|Starting with |For advice on )/i,
  );
  if (apacheTail >= 40) candidates.push(apacheTail);

  if (candidates.length === 0) return { description: trimmed };

  const splitAt = Math.min(...candidates);
  return {
    description: trimmed.slice(0, splitAt + 1).trim(),
    descriptionNote: trimmed.slice(splitAt + 1).trim() || undefined,
  };
}
