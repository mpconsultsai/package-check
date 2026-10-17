import { describe, it } from "vitest";
import { sanitizeDescription } from "@/lib/packages/sanitize";

describe("sanitizeDescription", () => {
  it("should be empty for a missing description", () => {
    sanitizeDescription(null).should.equal("");
    sanitizeDescription("   ").should.equal("");
  });

  it("should strip HTML tags and markdown images", () => {
    sanitizeDescription(
      '  <p>Hello</p> ![logo](https://example.com/a.png) world  ',
    ).should.equal("Hello world");
  });
});
