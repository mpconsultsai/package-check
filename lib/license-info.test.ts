import { describe, it } from "vitest";
import {
  describeLicense,
  inferSpdxFromLicenseText,
  licenseDisplayName,
  licenseFromPypiClassifiers,
  resolvePypiLicense,
} from "@/lib/license-info";

describe("licenseFromPypiClassifiers", () => {
  it("should be null without classifiers", () => {
    (licenseFromPypiClassifiers(undefined) === null).should.be.true;
  });

  it("should map a known licence classifier and skip OSI Approved", () => {
    licenseFromPypiClassifiers([
      "License :: OSI Approved",
      "License :: OSI Approved :: MIT License",
    ])!.should.equal("MIT");
  });
});

describe("inferSpdxFromLicenseText", () => {
  it("should recognise MIT and Apache text", () => {
    inferSpdxFromLicenseText(
      "Permission is hereby granted, free of charge, to any person obtaining a copy of this software",
    )!.should.equal("MIT");
    inferSpdxFromLicenseText(
      "Licensed under the Apache License, Version 2.0",
    )!.should.equal("Apache-2.0");
  });

  it("should be null when the text is unrecognised", () => {
    (inferSpdxFromLicenseText("custom terms") === null).should.be.true;
  });
});

describe("resolvePypiLicense", () => {
  it("should prefer a licence expression", () => {
    resolvePypiLicense({
      license_expression: "MIT OR Apache-2.0",
      license: "MIT",
    }).should.equal("MIT OR Apache-2.0");
  });

  it("should keep a short licence string", () => {
    resolvePypiLicense({ license: "BSD-3-Clause" }).should.equal("BSD-3-Clause");
  });

  it("should infer SPDX from a long licence block", () => {
    resolvePypiLicense({
      license: `${"MIT License\n".padEnd(200, "x")}`,
    }).should.equal("MIT");
  });

  it("should be Unknown when nothing is declared", () => {
    resolvePypiLicense({}).should.equal("Unknown");
  });
});

describe("licenseDisplayName", () => {
  it("should be Unknown for empty values", () => {
    licenseDisplayName(null).should.equal("Unknown");
    licenseDisplayName("  ").should.equal("Unknown");
    licenseDisplayName({}).should.equal("Unknown");
  });

  it("should read an npm licence object", () => {
    licenseDisplayName({ type: "MIT" }).should.equal("MIT");
  });

  it("should shorten a bundled licence text", () => {
    licenseDisplayName("x".repeat(200)).should.equal(
      "Multiple / bundled (see package metadata)",
    );
  });
});

describe("describeLicense", () => {
  it("should be null for an unknown licence", () => {
    (describeLicense(null) === null).should.be.true;
  });

  it("should describe a known SPDX id and the first token of an expression", () => {
    describeLicense("MIT")!.href!.should.match(/spdx\.org\/licenses\/MIT/);
    describeLicense("Apache-2.0 OR MIT")!.id.should.equal("Apache-2.0");
  });

  it("should link a bare SPDX-like id and a published url", () => {
    describeLicense("Custom-1.0")!.href!.should.match(/Custom-1\.0/);
    describeLicense("https://example.com/license")!.href!.should.equal(
      "https://example.com/license",
    );
  });

  it("should explain a non-SPDX label", () => {
    describeLicense("see licence file")!.summary.should.match(/not a standard SPDX/);
  });
});
