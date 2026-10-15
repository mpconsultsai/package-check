import { describe, it } from "vitest";
import { clientMetadata } from "@/lib/db/client-metadata";

describe("clientMetadata", () => {
  it("should read a desktop Safari user agent", () => {
    const headers = new Headers({
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    });
    clientMetadata(headers).should.deep.equal({
      userAgent: headers.get("user-agent"),
      agent: "Safari",
      browser: "Safari",
      browserVersion: "17.4",
      platform: "macOS",
      mobile: false,
    });
  });

  it("should prefer client hints over the user agent browser", () => {
    const headers = new Headers({
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      "sec-ch-ua": '"Chromium";v="128", "Google Chrome";v="128", "Not;A=Brand";v="24"',
      "sec-ch-ua-platform": '"Windows"',
      "sec-ch-ua-mobile": "?0",
    });
    const meta = clientMetadata(headers);
    meta.browser.should.equal("Google Chrome");
    meta.browserVersion.should.equal("128");
    meta.platform.should.equal("Windows");
    meta.mobile.should.equal(false);
    meta.agent.should.equal("Chrome");
  });

  it("should label an agent client ahead of the embedded browser", () => {
    const headers = new Headers({
      "user-agent": "Cursor/1.4.0 Chrome/128.0.0.0",
    });
    const meta = clientMetadata(headers);
    meta.agent.should.equal("Cursor");
    meta.should.not.have.property("browser");
  });
});
