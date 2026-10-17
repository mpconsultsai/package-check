import { describe, it } from "vitest";
import { getSiteUrl } from "@/lib/site/site-url";

describe("getSiteUrl", () => {
  it("should prefer the public site url and add https when needed", () => {
    const previous = process.env.NEXT_PUBLIC_SITE_URL;
    const render = process.env.RENDER_EXTERNAL_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "pkglens.example";
    getSiteUrl().should.equal("https://pkglens.example");
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    getSiteUrl().should.equal("http://localhost:3000");
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.RENDER_EXTERNAL_URL;
    getSiteUrl().should.equal("http://localhost:3000");
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous;
    if (render === undefined) delete process.env.RENDER_EXTERNAL_URL;
    else process.env.RENDER_EXTERNAL_URL = render;
  });
});
