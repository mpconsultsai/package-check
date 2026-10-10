import { timingSafeEqual } from "node:crypto";

let warnedMissingKey = false;

function sameSecret(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** True when Authorization is a bearer token matching MCP_API_KEY. */
export function mcpAuthorized(authorization: string | null): boolean {
  const expected = process.env.MCP_API_KEY?.trim();
  if (!expected) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      console.error("MCP_API_KEY is unset. /api/mcp rejects every request.");
    }
    return false;
  }
  const match = authorization?.match(/^Bearer\s+(\S+)\s*$/i);
  if (!match) return false;
  return sameSecret(match[1], expected);
}
