import semver from "semver";
import type { BreakingNoteItem, BreakingReleaseNote } from "@/lib/upgrade/upgrade-release-notes";

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Changesets bullets often start with PR/hash/thanks before the real note. */
function tidyChangesetBullet(text: string): string {
  let t = stripInlineMarkdown(text);
  t = t.replace(/^#\d+\s+[a-f0-9]{7,40}\s+/i, "");
  t = t.replace(/^Thanks\s+@[\w-]+\s*!\s*-\s*/i, "");
  t = t.replace(/^@[\w-]+\s*!\s*-\s*/i, "");
  // Fallback: take text after the attribution dash
  const dash = t.match(/!\s*-\s+(.+)$/);
  if (dash?.[1] && dash[1].length >= 12) t = dash[1];
  return t.trim();
}

function extractUrl(text: string): string | undefined {
  const m = text.match(/\((https?:\/\/(?:github\.com|www\.npmjs\.com)[^)\s]+)\)/i);
  return m?.[1];
}

/**
 * Parse changesets-style CHANGELOG.md for major / breaking notes in (from, to].
 */
export function extractChangelogBreakingNotes(input: {
  changelog: string;
  from: string;
  to: string;
  packageName: string;
  changelogUrl?: string;
}): BreakingReleaseNote[] {
  const from =
    semver.clean(input.from) ?? (semver.valid(input.from) ? input.from : null);
  const to = semver.clean(input.to) ?? (semver.valid(input.to) ? input.to : null);
  if (!from || !to || !semver.lt(from, to)) return [];

  const text = input.changelog.replace(/\r\n/g, "\n");
  const headingRe = /^##\s+(\d+\.\d+\.\d+[^\s]*)\s*$/gm;
  const matches = [...text.matchAll(headingRe)];
  const notes: BreakingReleaseNote[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const versionRaw = match[1];
    const version =
      semver.clean(versionRaw) ?? (semver.valid(versionRaw) ? versionRaw : null);
    if (!version) continue;
    if (!semver.gt(version, from) || !semver.lte(version, to)) continue;

    const start = (match.index ?? 0) + match[0].length;
    const end = matches[i + 1]?.index ?? text.length;
    const section = text.slice(start, end);

    const majorBlock = section.match(
      /###\s+Major Changes\s*\n([\s\S]*?)(?=\n###\s+|\n##\s+|$)/i,
    );
    const block = majorBlock?.[1] ?? "";
    const items: BreakingNoteItem[] = [];

    // Prefer bullets under Major Changes; also any explicit Breaking Change lines in section
    const source = block || section;
    const lines = source.split("\n");
    let current = "";
    let currentUrl: string | undefined;

    const flush = () => {
      const cleaned = tidyChangesetBullet(current);
      if (
        cleaned.length >= 12 &&
        !/^dependencies updates:?$/i.test(cleaned)
      ) {
        items.push({ text: cleaned, url: currentUrl });
      }
      current = "";
      currentUrl = undefined;
    };

    for (const raw of lines) {
      const line = raw.trimEnd();
      if (/^###\s+/.test(line.trim()) && !/^###\s+Major Changes/i.test(line.trim())) {
        flush();
        if (!majorBlock) break;
        continue;
      }
      if (/^##\s+/.test(line.trim())) {
        flush();
        break;
      }

      if (/^[-*]\s+/.test(line.trim())) {
        flush();
        current = line.trim().replace(/^[-*]\s+/, "");
        currentUrl = extractUrl(line);
        continue;
      }

      if (current && line.trim()) {
        current = `${current} ${line.trim()}`;
        currentUrl = currentUrl ?? extractUrl(line);
      } else if (
        !current &&
        /breaking\s*change/i.test(line) &&
        line.trim().length > 12
      ) {
        current = line.trim();
        currentUrl = extractUrl(line);
        flush();
      }
    }
    flush();

    // Keep major-only focus: if we only had a Major Changes block, items are from there.
    // If no major block, only keep lines that mention breaking.
    const filtered = majorBlock
      ? items
      : items.filter((item) => /breaking/i.test(item.text));

    const isMajorLine =
      semver.minor(version) === 0 && semver.patch(version) === 0;

    if (filtered.length === 0 && !isMajorLine) continue;

    notes.push({
      version,
      tag: version,
      title: `${input.packageName}@${version}`,
      url: input.changelogUrl,
      items:
        filtered.length > 0
          ? filtered.slice(0, 8)
          : [
              {
                text: "Major release listed in CHANGELOG - review the full changelog for migration notes.",
              },
            ],
      inferredMajor: filtered.length === 0 && isMajorLine,
    });
  }

  return notes.sort((a, b) => semver.compare(a.version, b.version)).slice(0, 12);
}

export async function fetchPackageChangelog(input: {
  owner: string;
  repo: string;
  directory?: string | null;
}): Promise<{ markdown: string; path: string; branch: string } | null> {
  const dirs = [
    input.directory?.replace(/^\/+|\/+$/g, "") || null,
    null,
  ].filter((v, i, arr) => arr.indexOf(v) === i);

  const branches = ["main", "master"];
  const files = ["CHANGELOG.md", "changelog.md", "HISTORY.md"];

  for (const branch of branches) {
    for (const dir of dirs) {
      for (const file of files) {
        const path = dir ? `${dir}/${file}` : file;
        const url = `https://raw.githubusercontent.com/${input.owner}/${input.repo}/${branch}/${path}`;
        try {
          const res = await fetch(url, {
            headers: { "User-Agent": "pkglens/1.0" },
            signal: AbortSignal.timeout(12_000),
          });
          if (!res.ok) continue;
          const markdown = await res.text();
          if (markdown && markdown.length > 40 && /^#/m.test(markdown)) {
            return { markdown, path, branch };
          }
        } catch {
          // try next candidate
        }
      }
    }
  }
  return null;
}
