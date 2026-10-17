import axios from "axios";
import semver from "semver";
import {
  fetchGitHubReleaseByTag,
  fetchGitHubReleases,
  parseGitHubUrl,
} from "@/lib/data-fetchers/github";
import { fetchNpmPackageData } from "@/lib/data-fetchers/npm-registry";
import {
  collectBreakingNotes,
  diffPeerDependencies,
  type BreakingReleaseNote,
  type PeerChange,
} from "@/lib/upgrade/upgrade-release-notes";
import {
  extractChangelogBreakingNotes,
  fetchPackageChangelog,
} from "@/lib/upgrade/upgrade-changelog";
import { listStableVersions } from "@/lib/upgrade/upgrade-advisor";
import type { GitHubReleaseData } from "@/lib/types/package-data";

export type UpgradeDetailsResult = {
  packageName: string;
  from: string;
  to: string;
  github: {
    owner: string;
    repo: string;
    directory: string | null;
    compareUrl: string | null;
    releasesUrl: string | null;
    changelogUrl: string | null;
  } | null;
  breaking: {
    notes: BreakingReleaseNote[];
    matchedReleases: number;
    scannedReleases: number;
    changelogVersions: number;
    source: "changelog" | "github-releases" | "mixed" | "none";
    hasNotes: boolean;
  };
  peers: {
    available: boolean;
    changes: PeerChange[];
  };
};

async function fetchVersionPeers(
  packageName: string,
  version: string,
): Promise<Record<string, string> | null> {
  try {
    const encodedName = packageName.startsWith("@")
      ? packageName.replace("/", "%2F")
      : packageName;
    const response = await axios.get(
      `https://registry.npmjs.org/${encodedName}/${encodeURIComponent(version)}`,
      { timeout: 12_000 },
    );
    const peers = response.data?.peerDependencies;
    if (peers && typeof peers === "object") {
      return peers as Record<string, string>;
    }
    return {};
  } catch {
    return null;
  }
}

/** Key versions to fetch by tag: target + first release of each crossed major. */
function keyVersionsForNotes(
  from: string,
  to: string,
  allVersions: string[],
): string[] {
  const fromClean = semver.clean(from) ?? (semver.valid(from) ? from : null);
  const toClean = semver.clean(to) ?? (semver.valid(to) ? to : null);
  if (!fromClean || !toClean || !semver.lt(fromClean, toClean)) return [];

  const keys = new Set<string>([toClean]);
  const fromMajor = semver.major(fromClean);
  const toMajor = semver.major(toClean);

  for (let major = fromMajor + 1; major <= toMajor; major++) {
    const firstOfMajor = [...allVersions]
      .reverse()
      .find((v) => semver.valid(v) && semver.major(v) === major);
    if (
      firstOfMajor &&
      semver.gt(firstOfMajor, fromClean) &&
      semver.lte(firstOfMajor, toClean)
    ) {
      keys.add(firstOfMajor);
    }
    const zero = `${major}.0.0`;
    if (
      allVersions.includes(zero) &&
      semver.gt(zero, fromClean) &&
      semver.lte(zero, toClean)
    ) {
      keys.add(zero);
    }
  }

  return [...keys].sort((a, b) => semver.compare(a, b)).slice(0, 8);
}

function mergeReleases(batches: GitHubReleaseData[][]): GitHubReleaseData[] {
  const byTag = new Map<string, GitHubReleaseData>();
  for (const batch of batches) {
    for (const release of batch) {
      const key = release.tag_name.toLowerCase();
      const existing = byTag.get(key);
      if (!existing || (release.body && !existing.body)) {
        byTag.set(key, release);
      }
    }
  }
  return [...byTag.values()];
}

function mergeNotes(
  primary: BreakingReleaseNote[],
  secondary: BreakingReleaseNote[],
): BreakingReleaseNote[] {
  const byVersion = new Map<string, BreakingReleaseNote>();
  for (const note of [...secondary, ...primary]) {
    const existing = byVersion.get(note.version);
    if (!existing) {
      byVersion.set(note.version, note);
      continue;
    }
    const existingScore =
      (existing.inferredMajor ? 0 : existing.items.length) +
      (existing.url ? 0.5 : 0);
    const nextScore =
      (note.inferredMajor ? 0 : note.items.length) + (note.url ? 0.5 : 0);
    if (nextScore >= existingScore) byVersion.set(note.version, note);
  }
  return [...byVersion.values()].sort((a, b) =>
    semver.compare(a.version, b.version),
  );
}

/**
 * Breaking-change notes from GitHub releases / CHANGELOG + peerDependency diff.
 */
export async function loadUpgradeDetails(
  packageName: string,
  from: string,
  to: string,
): Promise<UpgradeDetailsResult> {
  const { data: npm } = await fetchNpmPackageData(packageName);
  const repoUrl = npm.repository?.url;
  const directory = npm.repository?.directory;
  const parsed = repoUrl ? parseGitHubUrl(repoUrl) : null;
  const allVersions = listStableVersions(npm.time);

  const [peerPair, recentReleases, taggedReleases, changelog] =
    await Promise.all([
      Promise.all([
        fetchVersionPeers(packageName, from),
        fetchVersionPeers(packageName, to),
      ]),
      parsed
        ? fetchGitHubReleases(parsed.owner, parsed.repo, 100, {
            includeBody: true,
          }).catch(() => [] as GitHubReleaseData[])
        : Promise.resolve([] as GitHubReleaseData[]),
      parsed
        ? Promise.all(
            keyVersionsForNotes(from, to, allVersions).map((version) =>
              fetchGitHubReleaseByTag(
                parsed.owner,
                parsed.repo,
                version,
                packageName,
              ),
            ),
          ).then((rows) =>
            rows.filter((r): r is GitHubReleaseData => Boolean(r)),
          )
        : Promise.resolve([] as GitHubReleaseData[]),
      parsed
        ? fetchPackageChangelog({
            owner: parsed.owner,
            repo: parsed.repo,
            directory,
          })
        : Promise.resolve(null),
    ]);

  const [fromPeers, toPeers] = peerPair;
  const peerChanges =
    fromPeers && toPeers ? diffPeerDependencies(fromPeers, toPeers) : [];

  const releases = mergeReleases([recentReleases, taggedReleases]);
  const fromGithub = collectBreakingNotes({
    from,
    to,
    releases,
    packageName,
  });

  const changelogUrl =
    parsed && changelog
      ? `https://github.com/${parsed.owner}/${parsed.repo}/blob/${changelog.branch}/${changelog.path}`
      : null;

  const fromChangelog = changelog
    ? extractChangelogBreakingNotes({
        changelog: changelog.markdown,
        from,
        to,
        packageName,
        changelogUrl: changelogUrl ?? undefined,
      })
    : [];

  const notes = mergeNotes(fromGithub.notes, fromChangelog);
  const source =
    fromChangelog.length > 0 && fromGithub.notes.length === 0
      ? "changelog"
      : fromChangelog.length > 0
        ? "mixed"
        : fromGithub.notes.length > 0
          ? "github-releases"
          : "none";

  const compareUrl =
    parsed && from !== to
      ? `https://github.com/${parsed.owner}/${parsed.repo}/compare/${encodeURIComponent(`${packageName}@${from.replace(/^v/i, "")}`)}...${encodeURIComponent(`${packageName}@${to.replace(/^v/i, "")}`)}`
      : null;

  const releasesUrl = parsed
    ? `https://github.com/${parsed.owner}/${parsed.repo}/releases`
    : null;

  return {
    packageName,
    from,
    to,
    github: parsed
      ? {
          owner: parsed.owner,
          repo: parsed.repo,
          directory: directory ?? null,
          compareUrl,
          releasesUrl,
          changelogUrl,
        }
      : null,
    breaking: {
      notes,
      matchedReleases: fromGithub.matchedReleases,
      scannedReleases: fromGithub.scannedReleases,
      changelogVersions: fromChangelog.length,
      source,
      hasNotes: notes.some((n) => n.items.length > 0 && !n.inferredMajor),
    },
    peers: {
      available: Boolean(fromPeers && toPeers),
      changes: peerChanges,
    },
  };
}

/** Compact payload for LLM tools (truncate long note text). */
export function truncateUpgradeDetailsForAgent(
  details: UpgradeDetailsResult,
  maxNotes = 8,
  maxItemsPerNote = 4,
): Record<string, unknown> {
  return {
    packageName: details.packageName,
    from: details.from,
    to: details.to,
    github: details.github
      ? {
          compareUrl: details.github.compareUrl,
          changelogUrl: details.github.changelogUrl,
          releasesUrl: details.github.releasesUrl,
        }
      : null,
    breaking: {
      source: details.breaking.source,
      hasNotes: details.breaking.hasNotes,
      matchedReleases: details.breaking.matchedReleases,
      scannedReleases: details.breaking.scannedReleases,
      notes: details.breaking.notes.slice(0, maxNotes).map((note) => ({
        version: note.version,
        title: note.title,
        inferredMajor: note.inferredMajor,
        items: note.items.slice(0, maxItemsPerNote).map((item) => ({
          text:
            item.text.length > 240 ? `${item.text.slice(0, 237)}…` : item.text,
        })),
      })),
    },
    peers: {
      available: details.peers.available,
      changes: details.peers.changes.slice(0, 20),
    },
  };
}
