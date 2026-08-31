/**
 * Configuration must fail loudly.
 *
 * A misconfigured deployment must never render a UI that looks like a protocol
 * with nothing in it. These tests reload the module with a stubbed env.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const CANONICAL = "0x7cD15c0d4F4741C2Ce3DD807246b6f13aA7f82A1";

async function loadConfig(override?: string) {
  vi.resetModules();
  if (override === undefined) {
    vi.stubEnv("VITE_TREASURY_TRIAL_ADDRESS", "");
    // stubEnv cannot delete, so emulate "unset" by clearing the stub entirely.
    vi.unstubAllEnvs();
  } else {
    vi.stubEnv("VITE_TREASURY_TRIAL_ADDRESS", override);
  }
  return import("./config");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("contract address resolution", () => {
  it("uses the canonical StudioNet deployment when nothing is overridden", async () => {
    const config = await loadConfig();
    expect(config.CONFIG_ERROR).toBeNull();
    expect(config.CONTRACT_ADDRESS).toBe(CANONICAL);
  });

  it("accepts a valid override", async () => {
    const other = "0xF4D5855c7944d240E7b6DC37a369D6b2Fe6ED514";
    const config = await loadConfig(other);
    expect(config.CONFIG_ERROR).toBeNull();
    expect(config.CONTRACT_ADDRESS).toBe(other);
  });

  it("refuses an empty override instead of silently falling back", async () => {
    const config = await loadConfig("   ");
    expect(config.CONFIG_ERROR).toMatch(/set but empty/i);
    expect(config.CONTRACT_ADDRESS).toBe("");
  });

  it("refuses anything that is not a contract address", async () => {
    const config = await loadConfig("not-an-address");
    expect(config.CONFIG_ERROR).toMatch(/not a contract address/i);
    expect(config.CONTRACT_ADDRESS).toBe("");
  });

  it("pins the ABI shape the frontend was written against", async () => {
    const config = await loadConfig();
    expect(config.EXPECTED_WRITES).toBe(15);
    expect(config.EXPECTED_VIEWS).toBe(14);
    expect(config.EXPECTED_METHODS).toBe(29);
    expect(config.CHAIN_ID).toBe(61999);
  });
});
