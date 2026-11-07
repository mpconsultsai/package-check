import { describe, it } from "vitest";
import { truncateUpgradeDetailsForAgent } from "@/lib/upgrade/upgrade-details";
import type { UpgradeDetailsResult } from "@/lib/upgrade/upgrade-details";

function baseDetails(
  overrides: Partial<UpgradeDetailsResult> = {},
): UpgradeDetailsResult {
  return {
    packageName: "demo",
    from: "1.0.0",
    to: "2.0.0",
    github: null,
    breaking: {
      notes: [],
      matchedReleases: 0,
      scannedReleases: 0,
      changelogVersions: 0,
      source: "none",
      hasNotes: false,
    },
    peers: { available: false, changes: [] },
    manifest: null,
    releases: { total: 0, shown: [] },
    ...overrides,
  };
}

describe("truncateUpgradeDetailsForAgent", () => {
  it("should prefer concrete notes over inferred majors and keep item URLs", () => {
    const truncated = truncateUpgradeDetailsForAgent(
      baseDetails({
        breaking: {
          hasNotes: true,
          matchedReleases: 2,
          scannedReleases: 2,
          changelogVersions: 0,
          source: "github-releases",
          notes: [
            {
              version: "2.0.0",
              tag: "v2.0.0",
              title: "2.0.0",
              inferredMajor: true,
              items: [],
            },
            {
              version: "2.0.0",
              tag: "v2.0.0",
              title: "2.0.0",
              items: [
                {
                  text: "See the migration guide",
                  url: "https://example.com/migrate",
                },
              ],
            },
          ],
        },
      }),
      1,
      2,
    );
    const notes = truncated.breaking as {
      notes: Array<{
        inferredMajor?: boolean;
        items: Array<{ url?: string }>;
      }>;
    };
    notes.notes.should.have.length(1);
    (notes.notes[0].inferredMajor === true).should.equal(false);
    notes.notes[0].items[0].url!.should.equal("https://example.com/migrate");
  });
});
