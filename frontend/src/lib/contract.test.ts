/**
 * Adapter tests.
 *
 * The point of these is the rule the live network taught us: a hash is not
 * success, a returned value is not success, and only a re-read of authoritative
 * state can produce SUCCESS.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./config")>()),
  REVALIDATE_ATTEMPTS: 3,
  REVALIDATE_INTERVAL_MS: 0,
}));

import { MAX_PAGE_LIMIT } from "./config";

const readContract = vi.fn();
const writeContract = vi.fn();
const waitForTransactionReceipt = vi.fn();

vi.mock("genlayer-js", () => ({
  createClient: () => ({
    readContract,
    writeContract,
    waitForTransactionReceipt,
  }),
}));

import {
  policyLineage,
  reads,
  submitWrite,
  writes,
  type WriteContext,
} from "./contract";

const ctx: WriteContext = {
  account: "0x1111111111111111111111111111111111111111",
  provider: { request: vi.fn() },
};

/** The shape genlayer-js really returns: simplified, and snake_cased. */
const accepted = {
  status_name: "ACCEPTED",
  tx_execution_result_name: "FINISHED_WITH_RETURN",
  consensus_data: { final: false },
  num_of_rounds: "1",
};

beforeEach(() => {
  readContract.mockReset();
  writeContract.mockReset();
  waitForTransactionReceipt.mockReset();
  writeContract.mockResolvedValue("0xabc");
});

describe("reads", () => {
  it("parses the JSON string a view returns", async () => {
    readContract.mockResolvedValue(
      JSON.stringify({ dao_id: "example-dao", case_count: 2 }),
    );
    const dao = await reads.dao("example-dao");
    expect(dao.dao_id).toBe("example-dao");
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "get_dao", args: ["example-dao"] }),
    );
  });

  it("returns null rather than throwing for an unknown id", async () => {
    readContract.mockRejectedValue(new Error("dao not found"));
    await expect(reads.daoOptional("nope")).resolves.toBeNull();
  });

  it("rejects a non-string payload instead of guessing", async () => {
    readContract.mockResolvedValue({ dao_id: "x" });
    await expect(reads.dao("x")).rejects.toThrow(/non-string/);
  });
});

describe("submitWrite", () => {
  it("does not report success from a settled receipt alone", async () => {
    waitForTransactionReceipt.mockResolvedValue(accepted);
    const revalidate = vi.fn().mockResolvedValue(false);

    const outcome = await submitWrite(ctx, writes.freezeEvidence("c_1"), revalidate);

    expect(revalidate).toHaveBeenCalled();
    expect(outcome.phase).toBe("STATE_MISMATCH");
    expect(outcome.hash).toBe("0xabc");
  });

  it("reports success only after state confirms the mutation", async () => {
    waitForTransactionReceipt.mockResolvedValue(accepted);
    const outcome = await submitWrite(
      ctx,
      writes.freezeEvidence("c_1"),
      vi.fn().mockResolvedValue(true),
    );
    expect(outcome.phase).toBe("SUCCESS");
  });

  it("treats Undetermined as a discarded write, not a verdict", async () => {
    waitForTransactionReceipt.mockResolvedValue({
      status_name: "UNDETERMINED",
      tx_execution_result_name: "FINISHED_WITH_RETURN",
      num_of_rounds: "3",
    });
    const revalidate = vi.fn().mockResolvedValue(false);

    const outcome = await submitWrite(
      ctx,
      writes.requestAdjudication("c_1"),
      revalidate,
    );

    expect(outcome.phase).toBe("CONSENSUS_UNDETERMINED");
    // State is still consulted: the receipt does not get the final word.
    expect(revalidate).toHaveBeenCalled();
    expect(outcome.receipt?.numOfRounds).toBe("3");
  });

  it("believes contract state over an unreadable receipt", async () => {
    // The steward's writes finalized on-chain while the app said "No result
    // yet". Whatever the receipt says, if the mutation is in state, it landed.
    waitForTransactionReceipt.mockResolvedValue({ nothing: "recognisable" });
    const outcome = await submitWrite(
      ctx,
      writes.registerDao("example-dao"),
      vi.fn().mockResolvedValue(true),
    );
    expect(outcome.phase).toBe("SUCCESS");
  });

  it("retries the state check instead of failing on the first read", async () => {
    waitForTransactionReceipt.mockResolvedValue(accepted);
    const revalidate = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const outcome = await submitWrite(ctx, writes.freezeEvidence("c_1"), revalidate);

    expect(revalidate).toHaveBeenCalledTimes(2);
    expect(outcome.phase).toBe("SUCCESS");
  });

  it("surfaces a contract error with its reason", async () => {
    waitForTransactionReceipt.mockResolvedValue({
      status_name: "ACCEPTED",
      tx_execution_result_name: "FINISHED_WITH_ERROR",
      consensus_data: { leader_receipt: [{ error: "evidence already frozen" }] },
    });

    const outcome = await submitWrite(
      ctx,
      writes.freezeEvidence("c_1"),
      vi.fn().mockResolvedValue(true),
    );

    expect(outcome.phase).toBe("EXECUTION_ERROR");
    expect(outcome.revertReason).toBe("evidence already frozen");
  });

  it("reports a timeout when no receipt arrives and state has not changed", async () => {
    waitForTransactionReceipt.mockRejectedValue(new Error("timed out"));
    const outcome = await submitWrite(
      ctx,
      writes.finalizeCase("c_1"),
      vi.fn().mockResolvedValue(false),
    );
    expect(outcome.phase).toBe("TIMEOUT");
    expect(outcome.hash).toBe("0xabc");
  });

  it("reports success when no receipt arrived but the write did land", async () => {
    waitForTransactionReceipt.mockRejectedValue(new Error("timed out"));
    const outcome = await submitWrite(
      ctx,
      writes.finalizeCase("c_1"),
      vi.fn().mockResolvedValue(true),
    );
    expect(outcome.phase).toBe("SUCCESS");
  });

  it("reports a still-pending status as a timeout, not a success", async () => {
    waitForTransactionReceipt.mockResolvedValue({ status_name: "PENDING" });
    const outcome = await submitWrite(
      ctx,
      writes.finalizeCase("c_1"),
      vi.fn().mockResolvedValue(false),
    );
    expect(outcome.phase).toBe("TIMEOUT");
  });

  it("distinguishes a declined signature from a failure", async () => {
    writeContract.mockRejectedValue({ code: 4001, message: "User rejected" });
    const outcome = await submitWrite(
      ctx,
      writes.finalizeCase("c_1"),
      vi.fn().mockResolvedValue(true),
    );
    expect(outcome.phase).toBe("USER_REJECTED");
    expect(outcome.hash).toBeUndefined();
  });

  it("treats a throwing revalidator as unconfirmed", async () => {
    waitForTransactionReceipt.mockResolvedValue(accepted);
    const outcome = await submitWrite(
      ctx,
      writes.freezeEvidence("c_1"),
      vi.fn().mockRejectedValue(new Error("rpc down")),
    );
    expect(outcome.phase).toBe("STATE_MISMATCH");
  });

  it("reports phases in lifecycle order", async () => {
    waitForTransactionReceipt.mockResolvedValue(accepted);
    const phases: string[] = [];
    await submitWrite(
      ctx,
      writes.freezeEvidence("c_1"),
      vi.fn().mockResolvedValue(true),
      (phase) => phases.push(phase),
    );
    expect(phases).toEqual([
      "AWAITING_SIGNATURE",
      "SUBMITTED",
      "PROCESSING",
      "STATE_REVALIDATING",
    ]);
    expect(phases).not.toContain("SUCCESS");
  });
});

describe("write builders", () => {
  it("sends the bond as native value, not as an argument", async () => {
    waitForTransactionReceipt.mockResolvedValue(accepted);
    await submitWrite(
      ctx,
      writes.lockBond("c_1", 1_000_000_000_000_000_000n),
      vi.fn().mockResolvedValue(true),
    );
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "lock_bond",
        args: ["c_1"],
        value: 1_000_000_000_000_000_000n,
      }),
    );
  });

  it("sends zero value on every non-payable write", async () => {
    waitForTransactionReceipt.mockResolvedValue(accepted);
    await submitWrite(
      ctx,
      writes.executePayout("c_1"),
      vi.fn().mockResolvedValue(true),
    );
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ value: 0n }),
    );
  });

  it("passes only the case id to execute_payout, so no caller picks the recipient", () => {
    expect(writes.executePayout("c_1")).toEqual({
      method: "execute_payout",
      args: ["c_1"],
    });
  });

  it("encodes list arguments as JSON", () => {
    const request = writes.openChallenge(
      "c_1",
      "EVIDENCE_FABRICATED",
      "the quote does not appear on the cited page",
      ["e_1", "e_2"],
    );
    expect(request.args[3]).toBe('["e_1","e_2"]');
  });
});

describe("pagination", () => {
  it("never asks for a page larger than the contract allows", async () => {
    // The contract caps limit at MAX_PAGE_LIMIT and reverts above it. A reverted
    // history read renders as "no policy yet" for a DAO that has one, which is
    // exactly the bug this guards.
    readContract.mockResolvedValue(JSON.stringify({ total: 2, items: [] }));
    await policyLineage("example-dao-5");
    const [call] = readContract.mock.calls;
    const limit = Number((call?.[0] as { args: string[] }).args[2]);
    expect(limit).toBeLessThanOrEqual(MAX_PAGE_LIMIT);
    expect(MAX_PAGE_LIMIT).toBe(50);
  });

  it("returns an empty lineage rather than throwing when the DAO has none", async () => {
    readContract.mockResolvedValue(JSON.stringify({ total: 0, items: [] }));
    await expect(policyLineage("nobody")).resolves.toEqual([]);
  });
});
