import { describe, it } from "vitest";
import { SITE_NAME, SITE_TITLE } from "@/lib/site-brand";

describe("site brand", () => {
  it("should name the product Package Check", () => {
    SITE_NAME.should.equal("Package Check");
    SITE_TITLE.should.match(/Package Check/);
  });
});
