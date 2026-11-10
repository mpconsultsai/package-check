import { beforeEach, describe, it, vi } from "vitest";
import type { PackageEcosystem } from "@/lib/packages/package-routes";

const recordPackageSearch = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@/lib/db/package-searches", () => ({ recordPackageSearch }));

import { recordOpenedPackage } from "@/lib/db/record-opened-package";

describe("recordOpenedPackage", () => {
  beforeEach(() => {
    recordPackageSearch.mockClear();
  });

  it("should record the opened package immediately", () => {
    recordOpenedPackage(
      "pypi",
      " requests ",
      new Headers({ "user-agent": "Cursor/1.4.0" }),
    );
    recordPackageSearch.mock.calls.should.deep.equal([
      [
        {
          ecosystem: "pypi" satisfies PackageEcosystem,
          query: "requests",
          resultNames: ["requests"],
          source: "web",
          metadata: {
            page: true,
            resolved: true,
            userAgent: "Cursor/1.4.0",
            agent: "Cursor",
            mobile: false,
          },
        },
      ],
    ]);
  });

  it("should skip a name that is too short", () => {
    recordOpenedPackage("npm", " a ");
    recordPackageSearch.mock.calls.should.have.length(0);
  });
});
