import type { UpgradeAgentStreamEvent } from "@/lib/ai/upgrade-agent-events";

/**
 * Consume an SSE response body (`data: {json}\\n\\n` frames).
 * Invokes `onEvent` for each parsed UpgradeAgentStreamEvent.
 */
export async function consumeUpgradeAgentSse(
  response: Response,
  onEvent: (event: UpgradeAgentStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!response.body) {
    throw new Error("No response body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => undefined);
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const line = part
          .split("\n")
          .map((l) => l.trimEnd())
          .find((l) => l.startsWith("data:"));
        if (!line) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const event = JSON.parse(raw) as UpgradeAgentStreamEvent;
          if (event && typeof event === "object" && "type" in event) {
            onEvent(event);
          }
        } catch {
          // skip malformed frames
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
