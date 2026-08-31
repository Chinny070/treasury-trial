import { describe, expect, it } from "vitest";
import { fieldValue, formatDuration, formatGen, parseGen, shortAddress } from "./format";

describe("GEN amounts", () => {
  it("formats whole amounts without a fraction", () => {
    expect(formatGen("1000000000000000000")).toBe("1 GEN");
    expect(formatGen(0n)).toBe("0 GEN");
  });

  it("formats fractional amounts without float drift", () => {
    expect(formatGen("100000000000000000")).toBe("0.1 GEN");
    expect(formatGen("1234500000000000000")).toBe("1.2345 GEN");
  });

  it("round-trips through parseGen", () => {
    expect(parseGen("1").toString()).toBe("1000000000000000000");
    expect(parseGen("0.5").toString()).toBe("500000000000000000");
    expect(formatGen(parseGen("2.25"))).toBe("2.25 GEN");
  });

  it("refuses malformed input rather than coercing it", () => {
    expect(() => parseGen("")).toThrow();
    expect(() => parseGen("-1")).toThrow();
    expect(() => parseGen("1e18")).toThrow();
    expect(() => parseGen("abc")).toThrow();
  });

  it("does not lose precision beyond 18 decimals", () => {
    expect(parseGen("0.000000000000000001").toString()).toBe("1");
  });
});

describe("display helpers", () => {
  it("shortens addresses without inventing characters", () => {
    expect(shortAddress("0x7cD15c0d4F4741C2Ce3DD807246b6f13aA7f82A1")).toBe(
      "0x7cD1...82A1",
    );
    expect(shortAddress(undefined)).toBe("");
  });

  it("renders durations in the largest exact unit", () => {
    expect(formatDuration(86400)).toBe("1 day");
    expect(formatDuration(3600)).toBe("1 hour");
    expect(formatDuration(5400)).toBe("5400 seconds");
  });

  it("renders bond fields as GEN and window fields as durations", () => {
    expect(fieldValue("amendment_bond_requirement", "1000000000000000000")).toBe(
      "1 GEN",
    );
    expect(fieldValue("challenge_window_seconds", "86400")).toBe("1 day");
  });

  it("renders category lists from their JSON form", () => {
    expect(
      fieldValue("allowed_spending_categories.add", '["grants","events"]'),
    ).toBe("grants, events");
  });

  it("shows an empty value as a dash rather than blank", () => {
    expect(fieldValue("maximum_individual_allocation", "")).toBe("-");
  });
});
