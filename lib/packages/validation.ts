/**
 * npm package name validation per https://github.com/npm/validate-npm-package-name
 * Format: (@scope/)?package-name
 * - Scoped: @scope/package-name (scope + slash + package name required)
 * - Unscoped: package-name
 */
const VALID_PACKAGE_NAME_REGEX = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/**
 * Extract the package name from input, taking only the first token.
 * Handles inputs like "@graphql-inspector/cli graphql" → "@graphql-inspector/cli"
 */
export function extractPackageName(input: string): string {
  return (input?.trim().split(/\s+/)[0] || '').trim();
}

/** Lowercase npm name; add a missing @ for scope/name (e.g. angular/core → @angular/core). */
export function normalizeNpmPackageName(input: string): string {
  const name = extractPackageName(input).toLowerCase();
  if (
    name &&
    !name.startsWith("@") &&
    /^[a-z0-9-~][a-z0-9-._~]*\/[a-z0-9-~][a-z0-9-._~]*$/.test(name)
  ) {
    return `@${name}`;
  }
  return name;
}

/** PEP 503–style normalized project name (PyPI). */
const VALID_PYPI_NAME_REGEX =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

export function validatePyPiPackageName(packageName: string): {
  valid: boolean;
  error?: string;
} {
  const trimmed = extractPackageName(packageName);
  if (!trimmed) {
    return { valid: false, error: "Project name is required" };
  }
  if (VALID_PYPI_NAME_REGEX.test(trimmed)) {
    return { valid: true };
  }
  return {
    valid: false,
    error:
      'Invalid PyPI project name. Use letters, numbers, ".", "-", and "_".',
  };
}

/** NuGet package ids: letters, numbers, ".", "-", and "_". */
const VALID_NUGET_ID_REGEX =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/;

export function validateNugetPackageName(packageName: string): {
  valid: boolean;
  error?: string;
} {
  const trimmed = extractPackageName(packageName);
  if (!trimmed) {
    return { valid: false, error: "Package id is required" };
  }
  if (trimmed.length <= 100 && VALID_NUGET_ID_REGEX.test(trimmed)) {
    return { valid: true };
  }
  return {
    valid: false,
    error:
      'Invalid NuGet package id. Use letters, numbers, ".", "-", and "_".',
  };
}

/** Maven coordinates: groupId:artifactId (optional :version is stripped for validation). */
const VALID_MAVEN_SEGMENT =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;

export function validateMavenPackageName(packageName: string): {
  valid: boolean;
  error?: string;
} {
  const trimmed = extractPackageName(packageName);
  if (!trimmed) {
    return { valid: false, error: "Maven coordinate is required" };
  }
  // Bare artifact ids are allowed in search; package pages resolve via Solr.
  if (!trimmed.includes(":")) {
    if (trimmed.length <= 128 && VALID_MAVEN_SEGMENT.test(trimmed)) {
      return { valid: true };
    }
    return {
      valid: false,
      error:
        'Invalid Maven id. Use "artifactId" or "groupId:artifactId".',
    };
  }
  const [groupId, artifactId] = trimmed.split(":");
  if (
    groupId &&
    artifactId &&
    !trimmed.split(":")[2] &&
    VALID_MAVEN_SEGMENT.test(groupId) &&
    VALID_MAVEN_SEGMENT.test(artifactId)
  ) {
    return { valid: true };
  }
  // Allow group:artifact:version in paste lists — validate the first two segments.
  const parts = trimmed.split(":");
  if (
    parts.length >= 2 &&
    parts[0] &&
    parts[1] &&
    VALID_MAVEN_SEGMENT.test(parts[0]) &&
    VALID_MAVEN_SEGMENT.test(parts[1])
  ) {
    return { valid: true };
  }
  return {
    valid: false,
    error: 'Invalid Maven coordinate. Use "groupId:artifactId".',
  };
}

export function validatePackageNameForEcosystem(
  packageName: string,
  ecosystem: "npm" | "pypi" | "nuget" | "maven",
): { valid: boolean; error?: string } {
  if (ecosystem === "pypi") return validatePyPiPackageName(packageName);
  if (ecosystem === "nuget") return validateNugetPackageName(packageName);
  if (ecosystem === "maven") return validateMavenPackageName(packageName);
  return validatePackageName(packageName);
}

export function validatePackageName(packageName: string): { valid: boolean; error?: string } {
  const trimmed = extractPackageName(packageName);

  if (!trimmed) {
    return { valid: false, error: 'Package name is required' };
  }

  if (VALID_PACKAGE_NAME_REGEX.test(trimmed)) {
    return { valid: true };
  }

  // Helpful error for scope-only input (e.g. @graphql-inspector)
  if (trimmed.startsWith('@') && !trimmed.includes('/')) {
    return {
      valid: false,
      error: 'Scoped packages must include the package name. Example: @graphql-inspector/core',
    };
  }

  return {
    valid: false,
    error: 'Invalid package name format. Use "package-name" or "@scope/package-name"',
  };
}
