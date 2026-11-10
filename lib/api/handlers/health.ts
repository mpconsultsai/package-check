import { jsonOk, withHandler } from "@/lib/api/http";
import { databaseLogContext } from "@/lib/db/client";

export const GET = withHandler(async () => {
  const postgres = databaseLogContext();
  return jsonOk({
    status: "ok",
    timestamp: new Date().toISOString(),
    apiKeys: {
      google: Boolean(process.env.GOOGLE_API_KEY),
      groq: Boolean(process.env.GROQ_API_KEY),
      groqModel: Boolean(process.env.GROQ_MODEL?.trim()),
      groqUpgradeAgentModel: Boolean(
        process.env.GROQ_UPGRADE_AGENT_MODEL?.trim(),
      ),
      github: Boolean(process.env.GITHUB_TOKEN),
      mcp: Boolean(process.env.MCP_API_KEY?.trim()),
      postgres: postgres.configured,
    },
    postgres: postgres.configured
      ? { host: postgres.host, port: postgres.port, user: postgres.user }
      : null,
    message: "API is running",
  });
}, { logLabel: "health" });
