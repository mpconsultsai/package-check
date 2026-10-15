import { AsyncLocalStorage } from "node:async_hooks";

const currentRequest = new AsyncLocalStorage<Headers>();

/** Keep the MCP HTTP headers available while a tool runs. */
export function runWithMcpRequest<T>(
  request: Request,
  work: () => Promise<T>,
): Promise<T> {
  return currentRequest.run(request.headers, work);
}

export function currentMcpHeaders(): Headers | undefined {
  return currentRequest.getStore();
}
