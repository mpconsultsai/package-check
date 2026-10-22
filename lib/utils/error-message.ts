import axios from "axios";

export function registryUnavailableMessage(registry: string): string {
  return `Could not reach ${registry}. Try again in a moment.`;
}

/** Not-found copy is specific. Other registry failures stay generic. */
export function publicRegistryMessage(error: unknown, registry: string): string {
  if (error instanceof Error && /not found/i.test(error.message)) {
    return error.message;
  }
  return registryUnavailableMessage(registry);
}

export function errorMessage(error: unknown, fallback = "Unknown error"): string {
  if (axios.isAxiosError(error)) {
    return error.message || fallback;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

export function axiosResponseStatus(error: unknown): number | undefined {
  if (axios.isAxiosError(error)) {
    return error.response?.status;
  }
  return undefined;
}
