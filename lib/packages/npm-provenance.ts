import semver from "semver";

export type NpmProvenance = {
  /** The registry recorded a SLSA provenance attestation for this version. */
  verified: boolean;
  repositoryUrl: string | null;
  commit: string | null;
  /** Tag or branch the build ran from, without the refs/ prefix. */
  ref: string | null;
  /**
   * When the latest version has no attestation, the most recent prior stable
   * version that did. Null when there is no downgrade to report.
   */
  priorAttestedVersion?: string | null;
};

const EMPTY: NpmProvenance = {
  verified: false,
  repositoryUrl: null,
  commit: null,
  ref: null,
  priorAttestedVersion: null,
};

const TIME_META = new Set(["created", "modified", "unpublished"]);
const PRIOR_SCAN_LIMIT = 40;

export function emptyNpmProvenance(): NpmProvenance {
  return { ...EMPTY };
}

/** True when the version document says npm accepted a provenance attestation. */
export function npmHasProvenanceAttestation(dist: unknown): boolean {
  if (!dist || typeof dist !== "object") return false;
  const provenance = (dist as { attestations?: { provenance?: unknown } })
    .attestations?.provenance;
  return provenance != null && typeof provenance === "object";
}

/**
 * Most recent prior stable release that had provenance when `latestVersion`
 * does not. Scans by publish time, newest first.
 */
export function findPriorAttestedVersion(options: {
  latestVersion: string;
  versions: Record<string, { dist?: unknown } | undefined> | null | undefined;
  versionTimes?: Record<string, string> | null;
}): string | null {
  const latest = options.latestVersion.trim();
  if (!latest || !options.versions) return null;
  const latestDist = options.versions[latest]?.dist;
  if (npmHasProvenanceAttestation(latestDist)) return null;

  const times = options.versionTimes ?? {};
  const candidates = Object.keys(options.versions)
    .filter((version) => version !== latest)
    .filter((version) => !TIME_META.has(version))
    .filter((version) => {
      const cleaned = semver.valid(version);
      return Boolean(cleaned) && !semver.prerelease(cleaned!);
    })
    .filter((version) => Boolean(times[version]))
    .sort(
      (a, b) =>
        new Date(times[b]!).getTime() - new Date(times[a]!).getTime(),
    )
    .slice(0, PRIOR_SCAN_LIMIT);

  for (const version of candidates) {
    if (npmHasProvenanceAttestation(options.versions[version]?.dist)) {
      return version;
    }
  }
  return null;
}

/** Short note when latest lost a signed build that earlier releases had. */
export function npmProvenanceDowngradeNote(
  priorAttestedVersion: string | null | undefined,
): string | null {
  const version = priorAttestedVersion?.trim();
  if (!version) return null;
  return `Earlier release ${version} had a signed build.`;
}

/** Registry URL for the attestation bundle, limited to npm itself. */
export function npmAttestationsUrl(dist: unknown): string | null {
  if (!dist || typeof dist !== "object") return null;
  const url = (dist as { attestations?: { url?: unknown } }).attestations?.url;
  if (typeof url !== "string") return null;
  if (!url.startsWith("https://registry.npmjs.org/")) return null;
  return url;
}

function cleanGitRef(ref: unknown): string | null {
  if (typeof ref !== "string") return null;
  const trimmed = ref.trim().replace(/^refs\/(?:tags|heads)\//, "");
  return trimmed || null;
}

function decodeStatement(payload: unknown): unknown {
  if (typeof payload !== "string" || !payload.trim()) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function readSlsaProvenance(statement: unknown): NpmProvenance | null {
  if (!statement || typeof statement !== "object") return null;
  const predicate = (statement as { predicate?: unknown }).predicate;
  if (!predicate || typeof predicate !== "object") return null;
  const build = (predicate as { buildDefinition?: unknown }).buildDefinition;
  if (!build || typeof build !== "object") return null;
  const workflow = (
    build as {
      externalParameters?: { workflow?: Record<string, unknown> };
    }
  ).externalParameters?.workflow;
  const repositoryUrl =
    typeof workflow?.repository === "string" && workflow.repository.trim()
      ? workflow.repository.trim()
      : null;
  const deps = (build as { resolvedDependencies?: unknown }).resolvedDependencies;
  let commit: string | null = null;
  if (Array.isArray(deps)) {
    for (const dep of deps) {
      const sha = (dep as { digest?: { gitCommit?: unknown } })?.digest
        ?.gitCommit;
      if (typeof sha === "string" && /^[0-9a-f]{7,64}$/i.test(sha.trim())) {
        commit = sha.trim();
        break;
      }
    }
  }
  if (!repositoryUrl && !commit) return null;
  return {
    verified: true,
    repositoryUrl,
    commit,
    ref: cleanGitRef(workflow?.ref),
  };
}

/**
 * Source repo and commit from an npm attestations document.
 * Returns null when the bundle has no readable SLSA provenance statement.
 */
export function provenanceFromAttestationDocument(
  document: unknown,
): NpmProvenance | null {
  const list = (document as { attestations?: unknown })?.attestations;
  if (!Array.isArray(list)) return null;
  for (const entry of list) {
    const predicateType = (entry as { predicateType?: unknown })?.predicateType;
    if (predicateType !== "https://slsa.dev/provenance/v1") continue;
    const payload = (
      entry as { bundle?: { dsseEnvelope?: { payload?: unknown } } }
    ).bundle?.dsseEnvelope?.payload;
    const parsed = readSlsaProvenance(decodeStatement(payload));
    if (parsed) return parsed;
  }
  return null;
}
