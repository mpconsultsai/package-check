import { jsonOk, withHandler } from "@/lib/api/http";

export const GET = withHandler(async () => {
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
      postgres: Boolean(
        process.env.POSTGRES_DB_PWD?.trim() &&
          process.env.SUPABASE_URL?.trim() &&
          process.env.SUPABASE_DB_HOST?.trim(),
      ),
    },
    message: "API is running",
  });
}, { logLabel: "health" });
