import { validatePackageNameForEcosystem } from "@/lib/packages/validation";
import type { ParsedDependency } from "@/lib/parse/parse-dependency-list";

const SKIP_LINE =
  /^\s*(-r|--requirement|-c|-e|-f|--find-links|-i|--index-url|--extra-index-url|--trusted-host)\s/i;

/** Strip PEP 508 environment marker and comments. */
export function stripRequirementLine(raw: string): string {
  let line = raw.trim();
  if (!line || line.startsWith("#")) return "";
  const hash = line.indexOf("#");
  if (hash >= 0) line = line.slice(0, hash).trim();
  const marker = line.indexOf(";");
  if (marker >= 0) line = line.slice(0, marker).trim();
  return line;
}

/** Parse one PEP 508 requirement string (requirements.txt line or pyproject entry). */
export function parsePep508Line(raw: string): ParsedDependency | null {
  let line = stripRequirementLine(raw);
  if (!line || SKIP_LINE.test(line)) return null;
  if (/^https?:\/\//i.test(line) || /\s@\s*(git\+|https?:|ssh:)/i.test(line)) {
    return null;
  }

  line = line.replace(/^-e\s+/, "").trim();
  if (line.includes("@") && !line.startsWith("@")) {
    const atUrl = line.match(/^(.+?)\s@\s+\S+/);
    if (atUrl) line = atUrl[1].trim();
  }

  const nameMatch = line.match(
    /^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)(\[[^\]]*\])?\s*(.*)$/,
  );
  if (!nameMatch) return null;

  const name = nameMatch[1];
  const specPart = (nameMatch[3] || "").trim();
  const requested = specPart.length > 0 ? specPart : undefined;

  if (!validatePackageNameForEcosystem(name, "pypi").valid) return null;

  return { name, requested };
}
