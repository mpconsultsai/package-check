import { AxiosError } from "axios";
import { describe, it } from "vitest";
import {
  axiosResponseStatus,
  errorMessage,
  publicRegistryMessage,
  registryUnavailableMessage,
} from "@/lib/utils/error-message";

describe("errorMessage", () => {
  it("should use an axios error message", () => {
    errorMessage(new AxiosError("timed out")).should.equal("timed out");
  });

  it("should use an Error message", () => {
    errorMessage(new Error("boom")).should.equal("boom");
  });

  it("should fall back for an unknown value", () => {
    errorMessage("nope", "Request failed").should.equal("Request failed");
  });
});

describe("publicRegistryMessage", () => {
  it("should keep a not-found message", () => {
    publicRegistryMessage(
      new Error('Package "Serilog" not found on NuGet'),
      "NuGet",
    ).should.equal('Package "Serilog" not found on NuGet');
  });

  it("should hide the upstream API message", () => {
    publicRegistryMessage(
      new AxiosError("Request failed with status code 503"),
      "NuGet",
    ).should.equal(registryUnavailableMessage("NuGet"));
    publicRegistryMessage(new Error("Unexpected token '<'"), "npm").should.equal(
      "Could not reach npm. Try again in a moment.",
    );
  });
});

describe("axiosResponseStatus", () => {
  it("should read the response status", () => {
    const error = new AxiosError("nope");
    error.response = {
      status: 404,
      statusText: "Not Found",
      headers: {},
      config: error.config!,
      data: {},
    };
    axiosResponseStatus(error)!.should.equal(404);
  });

  it("should be undefined for a plain error", () => {
    (axiosResponseStatus(new Error("boom")) === undefined).should.be.true;
  });
});
