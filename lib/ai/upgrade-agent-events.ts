/** SSE / progressive events for the upgrade agent (safe for client import). */
export type UpgradeAgentBriefPayload = {
  headline: string;
  bullets: string[];
  risk: "low" | "moderate" | "high";
  nextSteps: string[];
  /** Named breakages / peer risks to verify (optional for older cached briefs). */
  watchFor?: string[];
};

export type UpgradeAgentStreamEvent =
  | {
      type: "status";
      stage: string;
    }
  | {
      type: "tools";
      toolCalls: string[];
    }
  | {
      type: "brief";
      brief: UpgradeAgentBriefPayload;
    }
  | {
      type: "done";
      model: string;
      toolCalls: string[];
      cached: boolean;
    }
  | {
      type: "error";
      message: string;
    };
