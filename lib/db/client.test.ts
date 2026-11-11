import { describe, it } from "vitest";
import { envValue, resolvePostgresPassword } from "@/lib/db/client";

describe("envValue", () => {
  it("should trim and strip wrapping quotes", () => {
    envValue('  "secret$1"  ').should.equal("secret$1");
    envValue("'hash#tag'").should.equal("hash#tag");
    envValue("plain").should.equal("plain");
  });
});

describe("resolvePostgresPassword", () => {
  it("should prefer base64 so special characters stay intact", () => {
    const password = 'p$a#s"s\'w\\ord';
    const encoded = Buffer.from(password, "utf8").toString("base64");
    resolvePostgresPassword({
      POSTGRES_DB_PWD_B64: encoded,
      POSTGRES_DB_PWD: "wrong",
    }).should.equal(password);
  });

  it("should fall back to the plain password", () => {
    resolvePostgresPassword({
      POSTGRES_DB_PWD: 'plain$pass',
    }).should.equal("plain$pass");
  });

  it("should accept a quoted base64 value from copy-paste", () => {
    const password = "supabase-db-pass";
    const encoded = Buffer.from(password, "utf8").toString("base64");
    resolvePostgresPassword({
      POSTGRES_DB_PWD_B64: `"${encoded}"`,
    }).should.equal(password);
  });
});
