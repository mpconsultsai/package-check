import { afterEach, describe, it, vi } from "vitest";
import { fetchJson, isServiceStartingError } from "@/lib/prefs/fetch-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchJson", () => {
  it("should explain an HTML error page when the server is offline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<!DOCTYPE html><html></html>", {
            status: 503,
            headers: { "Content-Type": "text/html" },
          }),
      ),
    );

    try {
      await fetchJson("/api/v1/health", { retries: 0 });
      true.should.equal(false);
    } catch (error) {
      (error as Error).message.should.equal(
        "Package Check is offline or still starting. Try again in a moment.",
      );
      isServiceStartingError(error).should.be.true;
    }
  });
});
