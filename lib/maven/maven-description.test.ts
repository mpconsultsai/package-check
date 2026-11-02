import { describe, it } from "vitest";
import { splitMavenDescription } from "@/lib/maven/maven-description";

describe("splitMavenDescription", () => {
  it("should keep a short summary alone", () => {
    splitMavenDescription("Guava is a set of Google core libraries for Java.")
      .should.deep.equal({
        description: "Guava is a set of Google core libraries for Java.",
      });
  });

  it("should prefer the first sentence when the rest has URLs", () => {
    const text =
      "Apache Commons Lang is a package of Java utility classes for the Java lang packages, classes that could be considered standard to justify their existence in java.lang. The code is tested using the latest revision of the JDK for supported LTS releases: 8, 11, 17, 21, and 25. See https://github.com/apache/commons-lang/blob/master/.github/workflows/maven.yml Please ensure your build environment is up-to-date.";
    const result = splitMavenDescription(text);
    result.description.should.equal(
      "Apache Commons Lang is a package of Java utility classes for the Java lang packages, classes that could be considered standard to justify their existence in java.lang.",
    );
    result.descriptionNote!.should.include("https://github.com/apache/commons-lang");
  });

  it("should still split on Apache CI / upgrade tails without an early URL sentence", () => {
    const text =
      "A long enough utility library summary that stands alone for readers of the package page. Starting with Commons Lang 3.9, we target Java 8 and use those features.";
    const result = splitMavenDescription(text);
    result.description.should.equal(
      "A long enough utility library summary that stands alone for readers of the package page.",
    );
    result.descriptionNote!.should.match(/^Starting with Commons Lang/);
  });
});
