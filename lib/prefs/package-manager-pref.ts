/** Canonical install command used in upgrade next steps. */
export function npmInstallCommand(
  packageName: string,
  version: string,
): string {
  return `npm i ${packageName}@${version}`;
}

/** Deterministic install checklist line for upgrade briefs. */
export function formatNpmInstallStep(
  packageName: string,
  version: string,
): string {
  return `Install the target version: \`${npmInstallCommand(packageName, version)}\``;
}
