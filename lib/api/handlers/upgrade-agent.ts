import {
  runUpgradeAgent,
  streamUpgradeAgent,
  UPGRADE_AGENT_GENERIC_ERROR,
  isUpgradeAgentProviderError,
} from "@/lib/ai/upgrade-agent";
import type { UpgradeAgentStreamEvent } from "@/lib/ai/upgrade-agent-events";
import { AppError } from "@/lib/api/errors";
import { jsonOk, withHandler } from "@/lib/api/http";
import {
  readJsonBody,
  requireFromTo,
  requirePackageName,
} from "@/lib/api/params";
import { NextResponse } from "next/server";

const sseHeaders = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

const encodeSse = (encoder: TextEncoder, event: UpgradeAgentStreamEvent) =>
  encoder.encode(`data: ${JSON.stringify(event)}\n\n`);

/** POST /api/v1/upgrade/agent - JSON by default; SSE when `stream: true` or Accept includes event-stream. */
export const POST = withHandler(
  async (request) => {
    const body = await readJsonBody(request);
    const packageName = requirePackageName(
      typeof body.packageName === "string"
        ? body.packageName
        : typeof body.package === "string"
          ? body.package
          : "",
    );
    const { from, to } = requireFromTo(
      typeof body.from === "string" ? body.from : "",
      typeof body.to === "string" ? body.to : "",
    );
    const force = body.force === true;
    const wantsStream =
      body.stream === true ||
      (request.headers.get("accept") ?? "").includes("text/event-stream");

    if (!process.env.GROQ_API_KEY?.trim()) {
      throw new AppError(UPGRADE_AGENT_GENERIC_ERROR, 503);
    }
    if (!process.env.GROQ_UPGRADE_AGENT_MODEL?.trim()) {
      throw new AppError(UPGRADE_AGENT_GENERIC_ERROR, 503);
    }

    if (wantsStream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            for await (const event of streamUpgradeAgent({
              packageName,
              from,
              to,
              force,
            })) {
              if (request.signal.aborted) break;
              controller.enqueue(encodeSse(encoder, event));
            }
          } catch (error: unknown) {
            console.error("upgrade/agent stream:", error);
            controller.enqueue(
              encodeSse(encoder, {
                type: "error",
                message: UPGRADE_AGENT_GENERIC_ERROR,
              }),
            );
          } finally {
            try {
              controller.close();
            } catch {
              // already closed
            }
          }
        },
      });

      return new NextResponse(stream, { headers: sseHeaders });
    }

    try {
      const result = await runUpgradeAgent({
        packageName,
        from,
        to,
        force,
      });

      return jsonOk({
        packageName,
        from,
        to,
        ...result,
      });
    } catch (error: unknown) {
      console.error("upgrade/agent:", error);
      if (error instanceof AppError) {
        throw new AppError(UPGRADE_AGENT_GENERIC_ERROR, error.status);
      }
      if (isUpgradeAgentProviderError(error)) {
        throw new AppError(UPGRADE_AGENT_GENERIC_ERROR, 502);
      }
      throw new AppError(UPGRADE_AGENT_GENERIC_ERROR, 502);
    }
  },
  {
    logLabel: "upgrade/agent",
    fallbackMessage: UPGRADE_AGENT_GENERIC_ERROR,
  },
);
