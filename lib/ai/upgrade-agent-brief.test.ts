import { describe, it } from "vitest";
import {
  buildContextualNextSteps,
  buildDeterministicBrief,
  buildSeedBullets,
  buildSeedWatchFor,
  computeUpgradeRisk,
  finalizeUpgradeBrief,
  isQuietUpgrade,
  mergeUpgradeNextSteps,
  type UpgradeBriefSeedInput,
} from "@/lib/ai/upgrade-agent-brief";

describe("computeUpgradeRisk", () => {
  it("should score patch with no notes as low", () => {
    computeUpgradeRisk({
      advice: { bump: "patch", majorsCrossed: 0 },
      details: { breaking: { hasNotes: false, notes: [] } },
    }).should.equal("low");
  });

  it("should score major with breaking notes as high", () => {
    computeUpgradeRisk({
      advice: { bump: "major", majorsCrossed: 0 },
      details: {
        breaking: {
          hasNotes: true,
          notes: [
            {
              version: "2.0.0",
              items: [{ text: "Removed legacy API" }],
            },
          ],
        },
      },
    }).should.equal("high");
  });

  it("should score worsening security as at least moderate", () => {
    computeUpgradeRisk({
      advice: { bump: "minor", majorsCrossed: 0 },
      details: { breaking: { hasNotes: false } },
      enrichment: {
        securityDelta: {
          delta: 2,
          summary: "Security worsens",
          severity: { critical: 0, high: 1 },
        },
      },
    }).should.equal("moderate");
  });

  it("should score still-open critical advisories as high", () => {
    computeUpgradeRisk({
      advice: { bump: "patch", majorsCrossed: 0 },
      security: {
        advisories: [
          {
            title: "RCE",
            severity: "critical",
            stillAffectsTo: true,
          },
        ],
        to: { critical: 1, high: 0, totalCount: 1 },
      },
    }).should.equal("high");
  });

  it("should raise risk when the current version is stale", () => {
    const twoYearsAgo = new Date(
      Date.now() - 800 * 86_400_000,
    ).toISOString();
    computeUpgradeRisk({
      advice: {
        bump: "minor",
        majorsCrossed: 0,
        fromPublishedAt: twoYearsAgo,
        daysBetween: 100,
      },
    }).should.equal("moderate");
  });

  it("should raise risk for many dependency or peer changes", () => {
    computeUpgradeRisk({
      advice: { bump: "patch", majorsCrossed: 0 },
      details: {
        manifestHighlights: { dependencyCount: 12 },
        peers: {
          changes: [
            { kind: "changed", name: "a" },
            { kind: "changed", name: "b" },
            { kind: "changed", name: "c" },
          ],
        },
      },
    }).should.equal("moderate");
  });

  it("should score a very stale major with a heavy peer graph as high", () => {
    computeUpgradeRisk({
      advice: {
        bump: "major",
        majorsCrossed: 1,
        daysBetween: 900,
        fromPublishedAt: new Date(Date.now() - 900 * 86_400_000).toISOString(),
      },
      enrichment: {
        peers: {
          count: 6,
          align: ["a", "b", "c", "d", "e", "f"],
        },
      },
    }).should.equal("high");
  });
});

describe("isQuietUpgrade", () => {
  it("should treat a bare patch bump as quiet", () => {
    isQuietUpgrade({
      advice: { bump: "patch", majorsCrossed: 0 },
      details: { breaking: { hasNotes: false, notes: [] } },
    }).should.equal(true);
  });

  it("should not treat majors or noted breakages as quiet", () => {
    isQuietUpgrade({
      advice: { bump: "major", majorsCrossed: 0 },
      details: { breaking: { hasNotes: false } },
    }).should.equal(false);

    isQuietUpgrade({
      advice: { bump: "minor", majorsCrossed: 0 },
      details: { breaking: { hasNotes: true } },
    }).should.equal(false);
  });
});

describe("buildSeedBullets", () => {
  it("should cite cleared advisory titles", () => {
    const bullets = buildSeedBullets({
      advice: { bump: "patch" },
      security: {
        advisories: [
          {
            title: "Prototype pollution",
            severity: "high",
            stillAffectsTo: false,
          },
        ],
      },
      enrichment: {
        securityDelta: {
          delta: -1,
          summary: "Security improves: 1 → 0 advisories (1 fewer on the target).",
        },
      },
    });
    bullets.some((b) => /Prototype pollution/i.test(b)).should.equal(true);
    bullets.some((b) => /Security improves/i.test(b)).should.equal(true);
  });

  it("should include named breaking items", () => {
    const bullets = buildSeedBullets({
      advice: { bump: "major" },
      details: {
        breaking: {
          hasNotes: true,
          notes: [
            {
              version: "18.0.0",
              items: [{ text: "Dropped Node 14 support" }],
            },
          ],
        },
      },
    });
    bullets.some((b) => /Dropped Node 14/i.test(b)).should.equal(true);
  });
});

describe("buildSeedWatchFor", () => {
  it("should list breaking items before peers", () => {
    const watch = buildSeedWatchFor({
      details: {
        breaking: {
          hasNotes: true,
          notes: [
            {
              version: "2.0.0",
              items: [{ text: "Renamed configure() to setup()" }],
            },
          ],
        },
        peers: {
          changes: [{ kind: "changed", name: "react", from: "^17", to: "^18" }],
        },
      },
      enrichment: {
        peers: {
          count: 1,
          align: ["react (^17 → ^18)"],
          summary: "Align 1 peer",
        },
      },
    });
    watch[0].should.match(/Renamed configure/);
  });
});

describe("finalizeUpgradeBrief", () => {
  it("should override model risk with the deterministic score", () => {
    const facts: UpgradeBriefSeedInput = {
      advice: { bump: "patch", majorsCrossed: 0 },
      details: { breaking: { hasNotes: false } },
    };
    const brief = finalizeUpgradeBrief(
      {
        headline: "All fine",
        risk: "high",
        bullets: ["Safe patch"],
        nextSteps: ["Install"],
      },
      facts,
    );
    brief.risk.should.equal("low");
  });

  it("should fill thin model bullets from seeds", () => {
    const brief = finalizeUpgradeBrief(
      { headline: "Go", risk: "moderate", bullets: [], nextSteps: [] },
      {
        advice: { bump: "minor" },
        enrichment: {
          peers: {
            count: 1,
            summary: "Align 1 peer dependency: react (^17 → ^18)",
            align: ["react (^17 → ^18)"],
          },
        },
        details: { peers: { changes: [{ kind: "changed", name: "react" }] } },
      },
    );
    brief.bullets.some((b) => /react/i.test(b)).should.equal(true);
  });

  it("should treat null watchFor like an omitted list", () => {
    const brief = finalizeUpgradeBrief(
      {
        headline: "Major upgrade",
        risk: "high",
        bullets: ["Engine change"],
        // Models often emit null instead of [] / omit
        watchFor: null as unknown as undefined,
        nextSteps: ["Install"],
      },
      {
        advice: { bump: "major", majorsCrossed: 1 },
        details: { breaking: { hasNotes: false } },
      },
    );
    Array.isArray(brief.watchFor).should.equal(true);
  });

  it("should inject Node and peer steps for the selected range", () => {
    const brief = finalizeUpgradeBrief(
      {
        headline: "Careful major",
        risk: "high",
        bullets: ["Major bump"],
        nextSteps: ["Install somehow"],
      },
      {
        advice: { bump: "major", majorsCrossed: 1 },
        runtime: {
          node: "12.22.0",
          nodeEngine: ">=14",
          nodeSatisfies: false,
        },
        enrichment: {
          peers: {
            count: 1,
            align: ["fill-range (^4 → ^7)"],
          },
        },
      },
      { packageName: "braces", from: "2.3.0", to: "3.0.3" },
    );
    brief.nextSteps[0].should.match(/Upgrade Node first/);
    brief.nextSteps.some((s) => /fill-range/.test(s)).should.equal(true);
    brief.nextSteps.some((s) => /npm i braces@3\.0\.3/.test(s)).should.equal(
      true,
    );
  });
});

describe("buildDeterministicBrief", () => {
  it("should produce a quiet patch checklist without inventing breakages", () => {
    const brief = buildDeterministicBrief(
      {
        advice: { bump: "patch", majorsCrossed: 0 },
        details: {
          breaking: { hasNotes: false, notes: [] },
          github: { changelogUrl: "https://example.com/CHANGELOG.md" },
        },
      },
      "lodash",
      "4.17.20",
      "4.17.21",
    );
    brief.risk.should.equal("low");
    brief.nextSteps[0].should.match(/CHANGELOG|release notes/);
    brief.nextSteps.some((s) => /npm i lodash@4\.17\.21/.test(s)).should.equal(
      true,
    );
  });
});

describe("buildContextualNextSteps", () => {
  it("should put a Node upgrade before install when the runtime fails engines", () => {
    const steps = buildContextualNextSteps(
      {
        advice: { bump: "major" },
        runtime: {
          node: "16.20.0",
          nodeEngine: ">=18",
          nodeSatisfies: false,
          nodeMessage: "Node 16.20.0 does not satisfy engines.node >=18",
        },
        enrichment: {
          peers: {
            count: 1,
            align: ["react (^17 → ^18)"],
            summary: "Align 1 peer",
          },
        },
      },
      "braces",
      "2.3.0",
      "3.0.3",
    );
    steps[0].should.match(/Upgrade Node first/);
    steps[0].should.match(/16\.20\.0/);
    steps[0].should.match(/braces@3\.0\.3/);
    steps.some((s) => /peer dependencies/i.test(s)).should.equal(true);
    steps.some((s) => /react/.test(s)).should.equal(true);
    const installIdx = steps.findIndex((s) => /npm i braces@3\.0\.3/.test(s));
    installIdx.should.be.greaterThan(0);
    steps.findIndex((s) => /Upgrade Node/.test(s)).should.be.lessThan(
      installIdx,
    );
  });

  it("should name the selected from→to range in review and peer steps", () => {
    const steps = buildContextualNextSteps(
      {
        details: {
          peers: {
            changes: [
              { kind: "changed", name: "webpack", from: "^4", to: "^5" },
            ],
          },
        },
      },
      "css-loader",
      "5.0.0",
      "6.0.0",
    );
    steps.some((s) => /5\.0\.0 → 6\.0\.0/.test(s)).should.equal(true);
    steps.some((s) => /webpack/.test(s)).should.equal(true);
  });

  it("should call out dropped peer OR-clauses like GraphQL 15", () => {
    const steps = buildContextualNextSteps(
      {
        details: {
          peers: {
            changes: [
              {
                kind: "changed",
                name: "graphql",
                from: "^15.2.0 || ^16.0.0 || ^17.0.0",
                to: "^16.0.0 || ^17.0.0",
              },
            ],
          },
        },
      },
      "graphql-yoga",
      "3.0.0",
      "5.0.0",
    );
    const peerStep =
      steps.find((s) => /peer dependenc/i.test(s) && /drops \^15\.2\.0/.test(s)) ??
      "";
    peerStep.should.match(/drops \^15\.2\.0/);
    peerStep.should.match(/15\.x no longer accepted/);
  });

  it("should require reviewing stale baselines and dependency churn", () => {
    const steps = buildContextualNextSteps(
      {
        advice: {
          bump: "major",
          fromPublishedAt: new Date(Date.now() - 800 * 86_400_000).toISOString(),
          daysBetween: 800,
        },
        details: {
          manifestHighlights: { dependencyCount: 11 },
        },
      },
      "lodash",
      "3.10.1",
      "4.17.21",
    );
    steps.some((s) => /extra regression coverage|stale baselines/i.test(s)).should.equal(
      true,
    );
    steps.some((s) => /11 dependency changes/i.test(s)).should.equal(true);
  });

  it("should include project peer conflict and engines steps when present", () => {
    const steps = buildContextualNextSteps(
      {
        runtime: {
          node: "20.11.0",
          nodeEngine: ">=18",
          nodeSatisfies: true,
        },
        project: {
          hasContext: true,
          packageRequested: "^5.0.0",
          enginesNode: ">=16",
          enginesConflict: true,
          conflictCount: 2,
          missingCount: 0,
          peerFits: [
            {
              name: "react",
              required: "^18.0.0",
              project: "^17.0.0",
              status: "conflicts",
            },
          ],
        },
      },
      "next",
      "14.0.0",
      "15.0.0",
    );
    steps.some((s) => /Align project peer react/.test(s)).should.equal(true);
    steps.some((s) => /\^17\.0\.0/.test(s)).should.equal(true);
    steps.some((s) => /Update package\.json engines\.node/.test(s)).should.equal(
      true,
    );
    steps.some((s) => /npm i next@15\.0\.0/.test(s)).should.equal(true);
  });

  it("should call out reverse peer conflicts from other project packages", () => {
    const steps = buildContextualNextSteps(
      {
        project: {
          hasContext: true,
          reversePeerFits: [
            {
              name: "@typescript-eslint/parser",
              at: "8.0.0",
              required: "^5.0.0",
              target: "6.0.0",
              status: "conflicts",
            },
          ],
        },
      },
      "typescript",
      "5.7.2",
      "6.0.0",
    );
    steps.some((s) => /@typescript-eslint\/parser@8\.0\.0/.test(s)).should.equal(
      true,
    );
    steps.some((s) => /peer range \^5\.0\.0/.test(s)).should.equal(true);
  });
});

describe("mergeUpgradeNextSteps", () => {
  it("should keep model detail while guaranteeing Node and install steps", () => {
    const steps = mergeUpgradeNextSteps(
      [
        "Check snapdragon call sites after the major bump.",
        "pnpm add braces@3.0.3",
      ],
      {
        runtime: {
          node: "14",
          nodeEngine: ">=8",
          nodeSatisfies: true,
        },
        enrichment: {
          peers: { count: 0, align: [], summary: "" },
        },
      },
      "braces",
      "2.3.0",
      "3.0.3",
    );
    steps.some((s) => /snapdragon/.test(s)).should.equal(true);
    steps.some((s) => /npm i braces@3\.0\.3/.test(s)).should.equal(true);
    steps.every((s) => !/pnpm/.test(s)).should.equal(true);
  });
});
