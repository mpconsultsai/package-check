import { describe, it } from "vitest";
import { asExecuteRows } from "@/lib/db/execute-rows";

describe("asExecuteRows", () => {
  it("should accept a plain array", () => {
    asExecuteRows<{ id: number }>([{ id: 1 }]).should.deep.equal([{ id: 1 }]);
  });

  it("should accept a { rows } wrapper", () => {
    asExecuteRows<{ id: number }>({ rows: [{ id: 2 }] }).should.deep.equal([
      { id: 2 },
    ]);
  });

  it("should return an empty list for unknown shapes", () => {
    asExecuteRows(null).should.deep.equal([]);
    asExecuteRows({}).should.deep.equal([]);
  });
});
