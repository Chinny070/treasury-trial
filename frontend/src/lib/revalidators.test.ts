/**
 * Revalidator tests.
 *
 * These encode what "it actually happened" means for each write. The
 * verdictRecorded case is the one live StudioNet testing forced into existence.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const readContract = vi.fn();

vi.mock("genlayer-js", () => ({
  createClient: () => ({
    readContract,
    writeContract: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
  }),
}));

import { revalidators } from "./contract";

const json = (value: unknown) => JSON.stringify(value);

beforeEach(() => readContract.mockReset());

describe("verdictRecorded", () => {
  it("rejects the live failure shape: a decision reported but nothing stored", async () => {
    readContract.mockResolvedValue(
      json({
        case_id: "c_4",
        status: "EVIDENCE_FROZEN",
        proposed_decision: "",
        final_decision: "",
        history: [],
      }),
    );
    await expect(revalidators.verdictRecorded("c_4")()).resolves.toBe(false);
  });

  it("rejects a case still at EVIDENCE_FROZEN even with a decision string", async () => {
    readContract.mockResolvedValue(
      json({
        status: "EVIDENCE_FROZEN",
        proposed_decision: "ACCEPTED",
        history: [{ source: "adjudication", decision: "ACCEPTED", reason: "" }],
      }),
    );
    await expect(revalidators.verdictRecorded("c_4")()).resolves.toBe(false);
  });

  it("accepts a committed verdict", async () => {
    readContract.mockResolvedValue(
      json({
        status: "CHALLENGE_WINDOW",
        proposed_decision: "ACCEPTED",
        history: [{ source: "adjudication", decision: "ACCEPTED", reason: "" }],
      }),
    );
    await expect(revalidators.verdictRecorded("c_4")()).resolves.toBe(true);
  });

  it("is false when the view cannot be read at all", async () => {
    // An unknown case reverts, and the adapter turns that into null rather
    // than a thrown error. Either way the write is not confirmed.
    readContract.mockResolvedValue(undefined);
    const confirmed = await revalidators.verdictRecorded("c_9")();
    expect(confirmed).toBe(false);
  });
});

describe("state revalidators", () => {
  it("daoRegistered checks the record came back with the right id", async () => {
    readContract.mockResolvedValue(json({ dao_id: "example-dao" }));
    await expect(revalidators.daoRegistered("example-dao")()).resolves.toBe(true);
    readContract.mockResolvedValue(json({ dao_id: "other-dao" }));
    await expect(revalidators.daoRegistered("example-dao")()).resolves.toBe(false);
  });

  it("caseExists requires the counter to have moved", async () => {
    readContract.mockResolvedValue(json({ dao_id: "d", case_count: 3 }));
    await expect(revalidators.caseExists("d", 2)()).resolves.toBe(true);
    await expect(revalidators.caseExists("d", 3)()).resolves.toBe(false);
  });

  it("evidenceFrozen reads the case flag, not the transaction", async () => {
    readContract.mockResolvedValue(json({ evidence_frozen: false }));
    await expect(revalidators.evidenceFrozen("c_1")()).resolves.toBe(false);
    readContract.mockResolvedValue(json({ evidence_frozen: true }));
    await expect(revalidators.evidenceFrozen("c_1")()).resolves.toBe(true);
  });

  it("caseFinalized requires both DECIDED and a final decision", async () => {
    readContract.mockResolvedValue(json({ status: "DECIDED", final_decision: "" }));
    await expect(revalidators.caseFinalized("c_1")()).resolves.toBe(false);
    readContract.mockResolvedValue(
      json({ status: "DECIDED", final_decision: "REJECTED" }),
    );
    await expect(revalidators.caseFinalized("c_1")()).resolves.toBe(true);
  });

  it("bondStatusIs accepts only the expected settlement states", async () => {
    readContract.mockResolvedValue(json({ bond_status: "PAYOUT_PENDING" }));
    await expect(
      revalidators.bondStatusIs("c_1", ["PAYOUT_PENDING"])(),
    ).resolves.toBe(true);
    await expect(
      revalidators.bondStatusIs("c_1", ["REFUNDED", "SLASHED"])(),
    ).resolves.toBe(false);
  });

  it("pausedIs compares against the live config", async () => {
    readContract.mockResolvedValue(json({ paused: true }));
    await expect(revalidators.pausedIs(true)()).resolves.toBe(true);
    await expect(revalidators.pausedIs(false)()).resolves.toBe(false);
  });
});
