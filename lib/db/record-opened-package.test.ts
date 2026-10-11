import { beforeEach, describe, it, vi } from "vitest";
import type { PackageEcosystem } from "@/lib/package-routes";

const recordPackageSearch = vi.hoisted(() => vi.fn(async () => {}));
const after = vi.hoisted(() => vi.fn((task: () => unknown) => task()));

vi.mock("next/server", () => ({ after }));
vi.mock("@/lib/db/package-searches", () => ({ recordPackageSearch }));

import { recordOpenedPackage } from "@/lib/db/record-opened-package";

describe("recordOpenedPackage", () => {
  beforeEach(() => {
    after.mockClear();
    recordPackageSearch.mockClear();
  });

  it("should record the opened package after the response", () => {
    recordOpenedPackage("pypi", " requests ");
    after.mock.calls.should.have.length(1);
    recordPackageSearch.mock.calls.should.deep.equal([
      [
        {
          ecosystem: "pypi" satisfies PackageEcosystem,
          query: "requests",
          resultNames: ["requests"],
          source: "web",
          metadata: { page: true },
        },
      ],
    ]);
  });

  it("should skip a name that is too short", () => {
    recordOpenedPackage("npm", " a ");
    after.mock.calls.should.have.length(0);
  });
});
