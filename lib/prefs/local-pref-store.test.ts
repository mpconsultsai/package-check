import { afterEach, describe, it, vi } from "vitest";
import { createLocalPrefStore } from "@/lib/prefs/local-pref-store";

function stubWindowStorage() {
  const map = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    clear: () => map.clear(),
  };
  vi.stubGlobal("window", { localStorage });
  return localStorage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createLocalPrefStore", () => {
  it("should hydrate once from localStorage and notify subscribers", async () => {
    const localStorage = stubWindowStorage();
    localStorage.setItem("test-pref", "on");
    const store = createLocalPrefStore({
      key: "test-pref",
      defaultValue: false,
      parse: (raw) => raw === "on",
      serialize: (value) => (value ? "on" : "off"),
    });

    const listener = vi.fn();
    store.subscribe(listener);
    await Promise.resolve();
    store.get().should.equal(true);
    listener.mock.calls.length.should.be.greaterThan(0);

    store.set(false);
    localStorage.getItem("test-pref")!.should.equal("off");
    store.get().should.equal(false);
  });

  it("should expose the default as the server snapshot", () => {
    stubWindowStorage();
    const store = createLocalPrefStore({
      key: "server-pref",
      defaultValue: "system",
      parse: (raw) => raw ?? "system",
      serialize: (value) => value,
    });
    store.getServerSnapshot().should.equal("system");
  });
});
