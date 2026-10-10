import { handleMcpRoute } from "@/lib/mcp/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = handleMcpRoute;
export const POST = handleMcpRoute;
export const DELETE = handleMcpRoute;
