/** SPDX pages are the official identifier definitions. */
const SPDX_PAGE = (id: string) => `https://spdx.org/licenses/${id}.html`;

export interface LicenseInfo {
  /** Normalised SPDX id or original label */
  id: string;
  /** One-line meaning for adopters */
  summary: string;
  /** Official definition, when we have a stable URL */
  href?: string;
}

const LICENSES: Record<string, Omit<LicenseInfo, "id">> = {
  MIT: {
    summary:
      "Permissive - use, modify, and redistribute (including commercially) if you keep the copyright notice.",
    href: SPDX_PAGE("MIT"),
  },
  ISC: {
    summary:
      "Permissive, similar to MIT - use and redistribute with the copyright notice.",
    href: SPDX_PAGE("ISC"),
  },
  "Apache-2.0": {
    summary:
      "Permissive - use and modify freely, with a patent grant. Keep notices and state changes.",
    href: SPDX_PAGE("Apache-2.0"),
  },
  "BSD-2-Clause": {
    summary:
      "Permissive - use and redistribute with the copyright notice. No extra advertising clause.",
    href: SPDX_PAGE("BSD-2-Clause"),
  },
  "BSD-3-Clause": {
    summary:
      "Permissive - like 2-clause BSD, plus you must not use the author’s name to endorse products.",
    href: SPDX_PAGE("BSD-3-Clause"),
  },
  "0BSD": {
    summary: "Public-domain style - no conditions on use or redistribution.",
    href: SPDX_PAGE("0BSD"),
  },
  Unlicense: {
    summary: "Public-domain dedication - no copyright restrictions on use.",
    href: SPDX_PAGE("Unlicense"),
  },
  "CC0-1.0": {
    summary: "Public-domain dedication - waives copyright as far as the law allows.",
    href: SPDX_PAGE("CC0-1.0"),
  },
  "GPL-2.0": {
    summary:
      "Copyleft - if you distribute a modified version, you must share source under the GPL.",
    href: SPDX_PAGE("GPL-2.0-only"),
  },
  "GPL-2.0-only": {
    summary:
      "Copyleft - if you distribute a modified version, you must share source under GPL-2.0.",
    href: SPDX_PAGE("GPL-2.0-only"),
  },
  "GPL-2.0-or-later": {
    summary:
      "Copyleft - distribute modifications under GPL-2.0 or a later GPL version.",
    href: SPDX_PAGE("GPL-2.0-or-later"),
  },
  "GPL-3.0": {
    summary:
      "Strong copyleft - distribute modifications as GPL-3.0, including source and patent terms.",
    href: SPDX_PAGE("GPL-3.0-only"),
  },
  "GPL-3.0-only": {
    summary:
      "Strong copyleft - distribute modifications as GPL-3.0, including source and patent terms.",
    href: SPDX_PAGE("GPL-3.0-only"),
  },
  "GPL-3.0-or-later": {
    summary:
      "Strong copyleft - distribute modifications under GPL-3.0 or a later GPL version.",
    href: SPDX_PAGE("GPL-3.0-or-later"),
  },
  "LGPL-2.1": {
    summary:
      "Weak copyleft - you can link from closed-source code; changes to the library itself stay LGPL.",
    href: SPDX_PAGE("LGPL-2.1-only"),
  },
  "LGPL-2.1-only": {
    summary:
      "Weak copyleft - you can link from closed-source code; changes to the library itself stay LGPL.",
    href: SPDX_PAGE("LGPL-2.1-only"),
  },
  "LGPL-3.0": {
    summary:
      "Weak copyleft - linking is allowed; modifications to the library stay under LGPL-3.0.",
    href: SPDX_PAGE("LGPL-3.0-only"),
  },
  "LGPL-3.0-only": {
    summary:
      "Weak copyleft - linking is allowed; modifications to the library stay under LGPL-3.0.",
    href: SPDX_PAGE("LGPL-3.0-only"),
  },
  "AGPL-3.0": {
    summary:
      "Network copyleft - offering the software as a service also requires sharing source.",
    href: SPDX_PAGE("AGPL-3.0-only"),
  },
  "AGPL-3.0-only": {
    summary:
      "Network copyleft - offering the software as a service also requires sharing source.",
    href: SPDX_PAGE("AGPL-3.0-only"),
  },
  "MPL-2.0": {
    summary:
      "File-level copyleft - changed MPL files must stay MPL; the rest of your app can use another licence.",
    href: SPDX_PAGE("MPL-2.0"),
  },
  "EPL-2.0": {
    summary:
      "Weak copyleft used by Eclipse projects - modifications to EPL files must be shared.",
    href: SPDX_PAGE("EPL-2.0"),
  },
  "Artistic-2.0": {
    summary:
      "Permissive with conditions on how you distribute modified versions (common for Perl).",
    href: SPDX_PAGE("Artistic-2.0"),
  },
  "BlueOak-1.0.0": {
    summary: "Permissive - use and redistribute with the licence notice.",
    href: SPDX_PAGE("BlueOak-1.0.0"),
  },
  UNLICENSED: {
    summary:
      "Not an open-source grant - the publisher has not licensed the package for reuse.",
    href: "https://docs.npmjs.com/cli/v10/configuring-npm/package-json#license",
  },
  "PSF-2.0": {
    summary:
      "Permissive - Python Software Foundation licence; keep copyright notices.",
    href: "https://docs.python.org/3/license.html#psf-license",
  },
};

const ALIASES: Record<string, string> = {
  MIT: "MIT",
  ISC: "ISC",
  APACHE: "Apache-2.0",
  "APACHE-2": "Apache-2.0",
  "APACHE-2.0": "Apache-2.0",
  BSD: "BSD-3-Clause",
  "BSD-2": "BSD-2-Clause",
  "BSD-3": "BSD-3-Clause",
  "BSD-2-CLAUSE": "BSD-2-Clause",
  "BSD-3-CLAUSE": "BSD-3-Clause",
  GPL: "GPL-3.0-only",
  "GPL-2": "GPL-2.0-only",
  "GPL-3": "GPL-3.0-only",
  "GPLV2": "GPL-2.0-only",
  "GPLV3": "GPL-3.0-only",
  LGPL: "LGPL-3.0-only",
  AGPL: "AGPL-3.0-only",
  UNLICENCE: "Unlicense",
  UNLICENSE: "Unlicense",
};

/** PyPI wheels often embed full licence text for bundled deps - keep UI labels short. */
export const MAX_INLINE_LICENSE_LEN = 120;

const PYPI_CLASSIFIER_TO_SPDX: Record<string, string> = {
  "MIT License": "MIT",
  "MIT": "MIT",
  "BSD License": "BSD-3-Clause",
  "Apache Software License": "Apache-2.0",
  "Apache License 2.0 (Apache-2.0)": "Apache-2.0",
  "GNU General Public License v2 (GPLv2)": "GPL-2.0-only",
  "GNU General Public License v3 (GPLv3)": "GPL-3.0-only",
  "GNU Lesser General Public License v2 or later (LGPLv2+)":
    "LGPL-2.1-or-later",
  "GNU Lesser General Public License v3 (LGPLv3)": "LGPL-3.0-only",
  "Mozilla Public License 2.0 (MPL 2.0)": "MPL-2.0",
  "ISC License (ISCL)": "ISC",
  "Python Software Foundation License": "PSF-2.0",
  "The Unlicense (Unlicense)": "Unlicense",
};

export function licenseFromPypiClassifiers(
  classifiers: string[] | undefined,
): string | null {
  if (!classifiers?.length) return null;
  for (const c of classifiers) {
    if (!c.startsWith("License :: ")) continue;
    const tail = c.split(" :: ").pop()?.trim();
    if (!tail) continue;
    if (PYPI_CLASSIFIER_TO_SPDX[tail]) return PYPI_CLASSIFIER_TO_SPDX[tail];
    if (tail.startsWith("OSI Approved")) continue;
  }
  return null;
}

/** Guess SPDX from the start of a licence block (pandas-style bundled text). */
export function inferSpdxFromLicenseText(text: string): string | null {
  const head = text.slice(0, 4000);
  if (
    /\bBSD\s+3[- ]?Clause\b/i.test(head) ||
    /Redistribution and use in source and binary forms[\s\S]{0,800}Neither the name of the copyright holder/i.test(
      head,
    )
  ) {
    return "BSD-3-Clause";
  }
  if (/\bBSD\s+2[- ]?Clause\b/i.test(head)) return "BSD-2-Clause";
  if (
    /\bMIT License\b/i.test(head) ||
    /Permission is hereby granted, free of charge, to any person obtaining a copy of this software/i.test(
      head,
    )
  ) {
    return "MIT";
  }
  if (
    /\bApache License\b[\s\S]{0,120}\bVersion 2\.0\b/i.test(head) ||
    /Licensed under the Apache License, Version 2\.0/i.test(head)
  ) {
    return "Apache-2.0";
  }
  if (/PYTHON SOFTWARE FOUNDATION LICENSE VERSION 2/i.test(head)) {
    return "PSF-2.0";
  }
  if (/\bISC License\b/i.test(head)) return "ISC";
  if (/\bGNU GENERAL PUBLIC LICENSE\b[\s\S]{0,200}\bVersion 3\b/i.test(head)) {
    return "GPL-3.0-only";
  }
  if (/\bGNU GENERAL PUBLIC LICENSE\b[\s\S]{0,200}\bVersion 2\b/i.test(head)) {
    return "GPL-2.0-only";
  }
  return null;
}

export function resolvePypiLicense(info: {
  license?: string | null;
  license_expression?: string | null;
  classifiers?: string[];
}): string {
  const expr =
    typeof info.license_expression === "string"
      ? info.license_expression.trim()
      : "";
  if (expr) return expr;

  const fromClassifier = licenseFromPypiClassifiers(info.classifiers);
  const raw =
    typeof info.license === "string" ? info.license.trim() : "";

  if (raw.length > 0 && raw.length <= MAX_INLINE_LICENSE_LEN) return raw;

  const fromText = raw ? inferSpdxFromLicenseText(raw) : null;
  if (fromText) return fromText;
  if (fromClassifier) return fromClassifier;

  if (raw.length > MAX_INLINE_LICENSE_LEN) {
    return "Multiple / bundled (see package metadata)";
  }

  return raw || "Unknown";
}

export const licenseDisplayName = (license: unknown): string => {
  if (license == null) return "Unknown";
  if (typeof license === "string") {
    const trimmed = license.trim();
    if (!trimmed) return "Unknown";
    if (trimmed.length <= MAX_INLINE_LICENSE_LEN) return trimmed;
    return (
      inferSpdxFromLicenseText(trimmed) ??
      "Multiple / bundled (see package metadata)"
    );
  }
  if (typeof license === "object" && license && "type" in license) {
    const type = (license as { type?: unknown }).type;
    if (typeof type === "string" && type.trim()) {
      return licenseDisplayName(type);
    }
  }
  return "Unknown";
};

const firstSpdxToken = (raw: string): string =>
  raw
    .replace(/[()]/g, " ")
    .split(/\s+(?:OR|AND|WITH)\s+/i)
    .map((part) => part.trim())
    .find((part) => part.length > 0) ?? raw.trim();

export const describeLicense = (license: unknown): LicenseInfo | null => {
  const display = licenseDisplayName(license);
  if (display === "Unknown") return null;

  const token = firstSpdxToken(display);
  const aliasKey = token.toUpperCase();
  const id = LICENSES[token] ? token : ALIASES[aliasKey] ?? token;
  const known = LICENSES[id];
  if (known) return { id, ...known };

  if (/^[A-Za-z0-9][A-Za-z0-9.+_-]*$/.test(token)) {
    return {
      id: token,
      summary: "See the SPDX definition for terms and obligations.",
      href: SPDX_PAGE(token),
    };
  }

  if (/^https?:\/\/\S+$/i.test(display)) {
    return {
      id: display,
      summary: "Licence terms published with this package.",
      href: display,
    };
  }

  return {
    id: display,
    summary: "Check the package’s licence file - this is not a standard SPDX id.",
  };
};
