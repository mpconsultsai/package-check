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

/** Render's checkout often has no origin remote. The slug is owner/repo. */
function releaseRepoUrl(remote, slug) {
  const fromRemote = githubRepoUrl(remote);
  if (fromRemote) return fromRemote;
  const name = String(slug ?? "").trim().replace(/\.git$/, "");
  if (/^[\w.-]+\/[\w.-]+$/.test(name)) return `https://github.com/${name}`;
  return null;
}

function git(args, options = {}) {
  return execFileSync("git", args, { encoding: "utf8", ...options });
}

/** A Render checkout is often shallow and has no tags, so the changelog would miss commits. */
function fetchReleaseHistory() {
  let shallow = false;
  try {
    shallow = git(["rev-parse", "--is-shallow-repository"]).trim() === "true";
  } catch {
    return;
  }
  const args = ["fetch", "origin", "--tags"];
  if (shallow) args.push("--unshallow");
  try {
    git(args, { stdio: "inherit" });
  } catch {
    console.error(
      "Could not fetch full git history. The changelog uses the commits in this checkout.",
    );
  }
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

  const remotes = git(["remote"]).split("\n").map((name) => name.trim());
  const remote = remotes.includes("origin")
    ? git(["remote", "get-url", "origin"]).trim()
    : "";
  const repo = releaseRepoUrl(remote, process.env.RENDER_GIT_REPO_SLUG);
  if (!repo) {
    console.error("Could not determine the GitHub repository to push the release to.");
    process.exit(1);
  }

  git(["config", "user.email", "package-check-release@users.noreply.github.com"]);
  git(["config", "user.name", "package-check release"]);
  const url = `${repo}.git`;
  if (remote) git(["remote", "set-url", "origin", url]);
  else git(["remote", "add", "origin", url]);
  git(["checkout", "-B", branch]);

  process.env.GIT_ASKPASS = path.join(__dirname, "git-askpass.sh");
  process.env.GIT_TERMINAL_PROMPT = "0";
  fetchReleaseHistory();

  try {
    execFileSync("npm", ["exec", "--", "release-it", "--ci"], { stdio: "inherit" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "release-it failed";
    console.error(message.replaceAll(token, "***"));
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { githubRepoUrl, releaseRepoUrl };
