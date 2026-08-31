import { describe, expect, it } from "vitest";
import type { GenLayerTransaction } from "genlayer-js/types";
import {
  PHASE_COPY,
  isBusy,
  isTerminal,
  isUserRejection,
  readReceipt,
  readRevertReason,
} from "./txState";

const receipt = (raw: Record<string, unknown>) =>
  readReceipt(raw as unknown as GenLayerTransaction);

describe("readReceipt", () => {
  it("treats ACCEPTED with a return as decided", () => {
    const signals = receipt({
      statusName: "ACCEPTED",
      txExecutionResultName: "FINISHED_WITH_RETURN",
      consensus_data: { final: false },
      numOfRounds: "1",
    });
    expect(signals.decided).toBe(true);
    expect(signals.undetermined).toBe(false);
    expect(signals.executionErrored).toBe(false);
    expect(signals.consensusFinal).toBe(false);
  });

  it("treats FINALIZED as decided", () => {
    expect(receipt({ statusName: "FINALIZED" }).decided).toBe(true);
  });

  it.each(["UNDETERMINED", "CANCELED", "VALIDATORS_TIMEOUT", "LEADER_TIMEOUT"])(
    "treats %s as undetermined and not decided",
    (statusName) => {
      const signals = receipt({ statusName });
      expect(signals.undetermined).toBe(true);
      expect(signals.decided).toBe(false);
    },
  );

  it("does not let a returned value rescue an undetermined status", () => {
    // The live StudioNet failure: a transaction that reported an outcome while
    // consensus had discarded the write.
    const signals = receipt({
      statusName: "UNDETERMINED",
      txExecutionResultName: "FINISHED_WITH_RETURN",
    });
    expect(signals.undetermined).toBe(true);
    expect(signals.decided).toBe(false);
  });

  it("flags contract execution errors", () => {
    const signals = receipt({
      statusName: "ACCEPTED",
      txExecutionResultName: "FINISHED_WITH_ERROR",
    });
    expect(signals.executionErrored).toBe(true);
  });

  it("reports an unknown status as neither decided nor undetermined", () => {
    const signals = receipt({ statusName: "PENDING" });
    expect(signals.decided).toBe(false);
    expect(signals.undetermined).toBe(false);
  });

  it("survives a missing receipt", () => {
    const signals = readReceipt(undefined);
    expect(signals.decided).toBe(false);
    expect(signals.statusName).toBeUndefined();
  });
});

describe("readRevertReason", () => {
  it("extracts the leader receipt error", () => {
    expect(
      readRevertReason({
        consensus_data: { leader_receipt: [{ error: "bond already locked" }] },
      }),
    ).toBe("bond already locked");
  });

  it("falls back to a thrown error message", () => {
    expect(readRevertReason({ message: "insufficient funds" })).toBe(
      "insufficient funds",
    );
  });

  it("returns undefined when there is nothing to report", () => {
    expect(readRevertReason(undefined)).toBeUndefined();
    expect(readRevertReason({})).toBeUndefined();
  });
});

describe("isUserRejection", () => {
  it("recognises EIP-1193 code 4001", () => {
    expect(isUserRejection({ code: 4001 })).toBe(true);
  });

  it("recognises wallet wording", () => {
    expect(isUserRejection({ message: "User rejected the request." })).toBe(true);
    expect(isUserRejection({ message: "MetaMask Tx Signature: User denied" })).toBe(
      true,
    );
  });

  it("does not swallow real failures", () => {
    expect(isUserRejection({ message: "nonce too low" })).toBe(false);
    expect(isUserRejection(undefined)).toBe(false);
  });
});

describe("phase classification", () => {
  it("does not treat any pre-revalidation phase as terminal success", () => {
    expect(isBusy("SUBMITTED")).toBe(true);
    expect(isBusy("PROCESSING")).toBe(true);
    expect(isBusy("STATE_REVALIDATING")).toBe(true);
    expect(isTerminal("SUBMITTED")).toBe(false);
    expect(isTerminal("SUCCESS")).toBe(true);
  });

  it("describes Undetermined as a consensus condition, never as a verdict", () => {
    const copy = `${PHASE_COPY.CONSENSUS_UNDETERMINED.title} ${PHASE_COPY.CONSENSUS_UNDETERMINED.detail}`;
    expect(copy.toLowerCase()).not.toContain("rejected");
    expect(copy.toLowerCase()).not.toContain("success");
  });

  it("has copy for every phase", () => {
    for (const phase of Object.keys(PHASE_COPY)) {
      expect(PHASE_COPY[phase as keyof typeof PHASE_COPY].title).not.toBe("");
    }
  });
});
