import semver from "semver";

export type DependencySpecKind =
  | "pinned"
  | "caret"
  | "tilde"
  | "range"
  | "wildcard"
  | "other";

export interface DependencySpecDescription {
  kind: DependencySpecKind;
  /** Short label, e.g. "Pinned", "Caret (^)" */
  label: string;
  /** Human range, e.g. "19.0.0 ≤ v < 20.0.0" */
  detail: string;
}

function caretUpperBound(version: semver.SemVer): string {
  if (version.major > 0) return `${version.major + 1}.0.0`;
  if (version.minor > 0) return `0.${version.minor + 1}.0`;
  return `0.0.${version.patch + 1}`;
}

function tildeUpperBound(version: semver.SemVer): string {
  return `${version.major}.${version.minor + 1}.0`;
}

/**
 * Explain a package.json / lockfile version specifier for the paste-list UI.
 */
export function describeDependencySpec(
  spec: string | undefined,
): DependencySpecDescription | null {
  if (!spec) return null;
  const s = spec.trim();
  if (!s) return null;

  if (
    /^(workspace|file|link|portal|git\+?|http|https|ssh):/i.test(s) ||
    /^(github|gist|bitbucket|gitlab):/i.test(s)
  ) {
    return { kind: "other", label: "Non-registry", detail: s };
  }

  if (s === "*" || s === "x" || s === "latest") {
    return {
      kind: "wildcard",
      label: "Any",
      detail: "any published version",
    };
  }

  const exact = semver.clean(s) ?? (semver.valid(s) ? s : null);
  if (exact) {
    return {
      kind: "pinned",
      label: "Pinned",
      detail: `exact ${exact}`,
    };
  }

  if (s.startsWith("^")) {
    try {
      const min = semver.minVersion(s);
      if (min) {
        return {
          kind: "caret",
          label: "Caret (^)",
          detail: `${min.version} ≤ v < ${caretUpperBound(min)}`,
        };
      }
    } catch {
      // fall through
    }
    return { kind: "caret", label: "Caret (^)", detail: s };
  }

  if (s.startsWith("~")) {
    try {
      const min = semver.minVersion(s);
      if (min) {
        return {
          kind: "tilde",
          label: "Tilde (~)",
          detail: `${min.version} ≤ v < ${tildeUpperBound(min)}`,
        };
      }
    } catch {
      // fall through
    }
    return { kind: "tilde", label: "Tilde (~)", detail: s };
  }

  try {
    const min = semver.minVersion(s);
    if (min) {
      return {
        kind: "range",
        label: "Range",
        detail: `≥ ${min.version}`,
      };
    }
  } catch {
    // fall through
  }

  return { kind: "other", label: "Spec", detail: s };
}
