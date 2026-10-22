const { execFileSync } = require("node:child_process");
const path = require("node:path");

function githubRepoUrl(remote) {
  const cleaned = String(remote ?? "").trim().replace(/\.git$/, "");
  const ssh = cleaned.match(/^git@github\.com:(.+)$/);
  if (ssh) return `https://github.com/${ssh[1]}`;
  const https = cleaned.match(/^https:\/\/(?:[^@/]+@)?github\.com\/(.+)$/);
  if (https) return `https://github.com/${https[1]}`;
  return null;
}

function git(args, options = {}) {
  return execFileSync("git", args, { encoding: "utf8", ...options });
}

function main() {
  if (process.env.RENDER !== "true") return;

  const token = process.env.RELEASE_GITHUB_TOKEN?.trim();
  if (!token) {
    console.error(
      "Set RELEASE_GITHUB_TOKEN to a GitHub token that can push commits and tags.",
    );
    process.exit(1);
  }

  const branch = process.env.RENDER_GIT_BRANCH?.trim();
  if (!branch) {
    console.error("RENDER_GIT_BRANCH is unset, so the release has no branch to update.");
    process.exit(1);
  }

  const repo = githubRepoUrl(git(["remote", "get-url", "origin"]));
  if (!repo) {
    console.error("Origin is not a GitHub repository, so the release cannot be pushed.");
    process.exit(1);
  }

  git(["config", "user.email", "package-check-release@users.noreply.github.com"]);
  git(["config", "user.name", "package-check release"]);
  git(["remote", "set-url", "origin", `${repo}.git`]);
  git(["checkout", "-B", branch]);

  process.env.GIT_ASKPASS = path.join(__dirname, "git-askpass.sh");
  process.env.GIT_TERMINAL_PROMPT = "0";

  try {
    execFileSync("npm", ["exec", "--", "release-it", "--ci"], { stdio: "inherit" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "release-it failed";
    console.error(message.replaceAll(token, "***"));
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { githubRepoUrl };
