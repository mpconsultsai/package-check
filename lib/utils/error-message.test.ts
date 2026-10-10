import { AxiosError } from "axios";
import { describe, it } from "vitest";
import { axiosResponseStatus, errorMessage } from "@/lib/utils/error-message";

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
