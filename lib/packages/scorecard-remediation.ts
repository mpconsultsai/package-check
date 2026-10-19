/**
 * One maintainer action for a low OpenSSF Scorecard check.
 * Shortened from the remediation steps in the Scorecard check docs.
 */
const IMPROVEMENTS: Record<string, string> = {
  "Binary-Artifacts":
    "Remove generated executables from the repository and build them from source.",
  "Branch-Protection":
    "Protect the default and release branches: block force-push and deletion, and require a pull request before merging.",
  "CI-Tests": "Run the test suite in CI on every pull request.",
  "CII-Best-Practices":
    "Earn an OpenSSF Best Practices badge. Passing scores 5, silver 7, and gold 10.",
  "Code-Review":
    "Require a human review on every pull request, including changes from administrators.",
  Contributors:
    "Recent commits from at least three organizations score highest. Ask contributors to set their company on GitHub.",
  "Dangerous-Workflow":
    "Do not check out pull-request code from a pull_request_target workflow, and do not pass untrusted GitHub event fields into run scripts.",
  "Dependency-Update-Tool":
    "Enable Dependabot or Renovate and commit the config file it expects.",
  Fuzzing:
    "Add fuzzing Scorecard can see, such as OSS-Fuzz, ClusterFuzzLite, or a supported property-based test.",
  License:
    "Add a LICENSE file in the repository root, named with an SPDX identifier.",
  Maintained:
    "This follows commits and collaborator issue activity over the last 90 days. An archived repository stays at the bottom.",
  Packaging:
    "Publish the package from a GitHub Action. Scorecard only detects the release workflows it knows.",
  "Pinned-Dependencies":
    "Pin GitHub Actions, Docker images, and build scripts to a full commit SHA or image digest.",
  SAST: "Run CodeQL, or another scanner Scorecard detects, in CI.",
  SBOM: "Publish a CycloneDX or SPDX SBOM with the release, not only in the source tree.",
  "Security-Policy":
    "Add SECURITY.md in the repository root explaining what a vulnerability is and how to report one privately.",
  "Signed-Releases":
    "Attach a signature, or a SLSA provenance file, beside each GitHub release asset.",
  "Token-Permissions":
    "Set workflow permissions to contents: read at the top, and grant write only on the jobs that need it.",
  Vulnerabilities:
    "Fix open findings in the repository, or update the dependency that contains them.",
  Webhooks: "Set a secret on each repository webhook so requests can be authenticated.",
};

export function scorecardImprovement(name: string): string {
  return (
    IMPROVEMENTS[name] ??
    "Follow the remediation steps in the OpenSSF check documentation."
  );
}
