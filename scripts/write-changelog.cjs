const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const RELEASE_COMMIT = /^v(\d+\.\d+\.\d+) \[skip render\]$/;
const ROOT = path.join(__dirname, "..");
const CHANGELOG_PATH = path.join(ROOT, "CHANGELOG.md");

function groupChangelog(commits, release) {
  const sections = [];
  let version = release.version;
  let date = release.date;
  let entries = [];

  const flush = () => {
    if (entries.length === 0) return;
    sections.push({ version, date, entries });
    entries = [];
  };

  for (const commit of commits) {
    const released = RELEASE_COMMIT.exec(commit.subject.trim());
    if (released) {
      flush();
      version = released[1];
      date = commit.date;
      continue;
    }
    const subject = commit.subject.trim();
    if (!subject) continue;
    entries.push({ subject, hash: commit.hash });
  }
  flush();
  return sections;
}

function renderChangelog(sections) {
  const body = sections
    .map((section) => {
      const items = section.entries.map(
        (entry) => `- ${entry.subject} (${entry.hash})`,
      );
      return [`## ${section.version} - ${section.date}`, "", ...items].join("\n");
    })
    .join("\n\n");
  return `# Changelog\n\n${body}\n`;
}

function readCommits() {
  const log = execFileSync(
    "git",
    ["log", "--no-merges", "--pretty=format:%s%x1f%h%x1f%as"],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (!log.trim()) return [];
  return log.split("\n").map((line) => {
    const [subject, hash, date] = line.split("\x1f");
    return { subject: subject ?? "", hash: hash ?? "", date: date ?? "" };
  });
}

function main() {
  const { version } = require(path.join(ROOT, "package.json"));
  const date = new Date().toISOString().slice(0, 10);
  const markdown = renderChangelog(
    groupChangelog(readCommits(), { version, date }),
  );
  fs.writeFileSync(CHANGELOG_PATH, markdown);
  execFileSync("git", ["add", "--", "CHANGELOG.md"], { cwd: ROOT });
}

if (require.main === module) main();

module.exports = { groupChangelog, renderChangelog };
