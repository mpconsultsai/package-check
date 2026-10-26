import { describe, it } from "vitest";
import {
  provenanceCommitUrl,
  provenanceRepoLabel,
} from "@/lib/packages/npm-package-facts";
import {
  findPriorAttestedVersion,
  npmAttestationsUrl,
  npmHasProvenanceAttestation,
  npmProvenanceDowngradeNote,
  provenanceFromAttestationDocument,
} from "@/lib/packages/npm-provenance";

const attestedDist = {
  attestations: {
    provenance: { predicateType: "https://slsa.dev/provenance/v1" },
  },
};

function slsaPayload(statement: unknown): string {
  return Buffer.from(JSON.stringify(statement), "utf8").toString("base64");
}

describe("npm provenance", () => {
  it("should notice a provenance attestation on the version document", () => {
    npmHasProvenanceAttestation({
      attestations: { provenance: { predicateType: "https://slsa.dev/provenance/v1" } },
    }).should.equal(true);
    npmHasProvenanceAttestation({ integrity: "sha512-abc" }).should.equal(false);
  });

  it("should only follow attestation URLs on the npm registry", () => {
    (
      npmAttestationsUrl({
        attestations: {
          url: "https://registry.npmjs.org/-/npm/v1/attestations/express@5.3.0",
        },
      }) ?? ""
    ).should.equal(
      "https://registry.npmjs.org/-/npm/v1/attestations/express@5.3.0",
    );
    (npmAttestationsUrl({
      attestations: { url: "https://example.com/attestations" },
    }) === null).should.equal(true);
  });

  it("should read the repo and commit from the SLSA statement", () => {
    const document = {
      attestations: [
        {
          predicateType: "https://github.com/npm/attestation/tree/main/specs/publish/v0.1",
          bundle: { dsseEnvelope: { payload: slsaPayload({ predicate: {} }) } },
        },
        {
          predicateType: "https://slsa.dev/provenance/v1",
          bundle: {
            dsseEnvelope: {
              payload: slsaPayload({
                predicateType: "https://slsa.dev/provenance/v1",
                predicate: {
                  buildDefinition: {
                    externalParameters: {
                      workflow: {
                        ref: "refs/tags/v5.3.0",
                        repository: "https://github.com/expressjs/express",
                        path: ".github/workflows/npm-publish.yml",
                      },
                    },
                    resolvedDependencies: [
                      {
                        uri: "git+https://github.com/expressjs/express@refs/tags/v5.3.0",
                        digest: { gitCommit: "cf6722bf89a86905281d9160b6482e08166b5ef0" },
                      },
                    ],
                  },
                },
              }),
            },
          },
        },
      ],
    };
    const parsed = provenanceFromAttestationDocument(document);
    parsed!.verified.should.equal(true);
    parsed!.repositoryUrl!.should.equal("https://github.com/expressjs/express");
    parsed!.commit!.should.equal("cf6722bf89a86905281d9160b6482e08166b5ef0");
    parsed!.ref!.should.equal("v5.3.0");
    provenanceRepoLabel(parsed!.repositoryUrl!).should.equal("expressjs/express");
    (
      provenanceCommitUrl(parsed!.repositoryUrl!, parsed!.commit!) ?? ""
    ).should.equal(
      "https://github.com/expressjs/express/commit/cf6722bf89a86905281d9160b6482e08166b5ef0",
    );
  });

  it("should find a prior attested release when latest lost provenance", () => {
    const prior = findPriorAttestedVersion({
      latestVersion: "2.0.0",
      versions: {
        "1.0.0": { dist: attestedDist },
        "1.1.0": { dist: attestedDist },
        "2.0.0": { dist: { integrity: "sha512-x" } },
      },
      versionTimes: {
        "1.0.0": "2025-01-01T00:00:00.000Z",
        "1.1.0": "2025-06-01T00:00:00.000Z",
        "2.0.0": "2025-09-01T00:00:00.000Z",
      },
    });
    (prior ?? "").should.equal("1.1.0");
    (npmProvenanceDowngradeNote(prior) ?? "").should.equal(
      "Earlier release 1.1.0 had a signed build.",
    );
  });

  it("should skip the downgrade note when latest still has provenance", () => {
    const prior = findPriorAttestedVersion({
      latestVersion: "2.0.0",
      versions: {
        "1.0.0": { dist: attestedDist },
        "2.0.0": { dist: attestedDist },
      },
      versionTimes: {
        "1.0.0": "2025-01-01T00:00:00.000Z",
        "2.0.0": "2025-09-01T00:00:00.000Z",
      },
    });
    (prior === null).should.equal(true);
    (npmProvenanceDowngradeNote(null) === null).should.equal(true);
  });
});
