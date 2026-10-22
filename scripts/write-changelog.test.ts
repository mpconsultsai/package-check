import { describe, it } from "vitest";
import { groupChangelog, renderChangelog } from "@/scripts/write-changelog.cjs";

const commits = [
  { subject: "chore: Update watchlist", hash: "74cef12", date: "2026-10-22" },
  { subject: "v0.1.2 [skip render]", hash: "9c26e50", date: "2026-10-21" },
  { subject: "chore: Add release", hash: "02ef372", date: "2026-10-20" },
  { subject: "v0.1.1 [skip render]", hash: "482525d", date: "2026-10-19" },
  { subject: "fix: Fix package search logging", hash: "45aaf6d", date: "2026-10-01" },
];

describe("groupChangelog", () => {
  it("should group commits under the release they shipped in", () => {
    const sections = groupChangelog(commits, {
      version: "0.1.3",
      date: "2026-10-22",
    });
    sections.map((section) => section.version).should.deep.equal([
      "0.1.3",
      "0.1.2",
      "0.1.1",
    ]);
    sections[0].entries.map((entry) => entry.subject).should.deep.equal([
      "chore: Update watchlist",
    ]);
    sections[1].date.should.equal("2026-10-21");
    sections[2].entries[0].hash.should.equal("45aaf6d");
  });

  it("should leave out release commits and empty sections", () => {
    const sections = groupChangelog(
      [{ subject: "v0.1.2 [skip render]", hash: "9c26e50", date: "2026-10-21" }],
      { version: "0.1.3", date: "2026-10-22" },
    );
    sections.should.deep.equal([]);
  });
});

describe("renderChangelog", () => {
  it("should write a markdown section for each release", () => {
    const markdown = renderChangelog([
      {
        version: "0.1.3",
        date: "2026-10-22",
        entries: [{ subject: "chore: Update watchlist", hash: "74cef12" }],
      },
    ]);
    markdown.should.equal(
      "# Changelog\n\n## 0.1.3 - 2026-10-22\n\n- chore: Update watchlist (74cef12)\n",
    );
  });
});
