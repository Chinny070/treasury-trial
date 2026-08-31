/**
 * Transaction lifecycle for Treasury Chamber.
 *
 * The rule this whole module exists to enforce, learned from live StudioNet
 * testing on 2026-08-31:
 *
 *   A transaction can report Execution Result SUCCESS and return a value that
 *   looks like a verdict, while consensus is UNDETERMINED and NOTHING was
 *   written to contract state.
 *
 * Case c_4's first adjudication returned "ACCEPTED" with all eight semantic
 * dimensions passing. A later finalize_case failed with "case is not awaiting
 * finalization", and the case was still sitting at EVIDENCE_FROZEN with an
 * empty verdict history. The transaction reported success and changed nothing.
 *
 * Therefore SUCCESS in this state machine is reachable only after an
 * authoritative re-read of contract state confirms the expected mutation.
 * A returned value is never evidence of anything.
 */

import type { GenLayerTransaction } from "genlayer-js/types";

export type TxPhase =
  /** Nothing in flight. */
  | "IDLE"
  /** A write was requested with no wallet connected. */
  | "WALLET_REQUIRED"
  /** Wallet is on a chain other than StudioNet. */
  | "WRONG_NETWORK"
  /** Waiting for the user to sign in their wallet. */
  | "AWAITING_SIGNATURE"
  /** Signed and broadcast. A hash exists. This is NOT success. */
  | "SUBMITTED"
  /** Waiting for validators to reach a decided state. */
  | "PROCESSING"
  /** Consensus was not reached. No state was committed. Retry is safe. */
  | "CONSENSUS_UNDETERMINED"
  /** Receipt looked decided; re-reading contract state to confirm. */
  | "STATE_REVALIDATING"
  /** Receipt decided AND contract state confirms the mutation. */
  | "SUCCESS"
  /** The contract itself rejected the call, usually a require failing. */
  | "EXECUTION_ERROR"
  /** The user declined to sign. */
  | "USER_REJECTED"
  /** No decided receipt within the configured window. */
  | "TIMEOUT"
  /** Receipt looked fine but contract state did not change as expected. */
  | "STATE_MISMATCH";

/** Phases in which nothing further will happen without user action. */
export const TERMINAL_PHASES: TxPhase[] = [
  "SUCCESS",
  "EXECUTION_ERROR",
  "USER_REJECTED",
  "TIMEOUT",
  "STATE_MISMATCH",
  "CONSENSUS_UNDETERMINED",
  "WALLET_REQUIRED",
  "WRONG_NETWORK",
];

export const isTerminal = (phase: TxPhase): boolean =>
  TERMINAL_PHASES.includes(phase);

export const isBusy = (phase: TxPhase): boolean =>
  phase === "AWAITING_SIGNATURE" ||
  phase === "SUBMITTED" ||
  phase === "PROCESSING" ||
  phase === "STATE_REVALIDATING";

/** Whether the user may safely press the button again in this phase. */
export const isRetryable = (phase: TxPhase): boolean =>
  phase === "CONSENSUS_UNDETERMINED" ||
  phase === "TIMEOUT" ||
  phase === "USER_REJECTED" ||
  phase === "EXECUTION_ERROR" ||
  phase === "STATE_MISMATCH";

export interface TxState {
  phase: TxPhase;
  hash?: string;
  /** Raw receipt signals, surfaced verbatim so a reviewer can audit them. */
  receipt?: ReceiptSignals;
  /** Human-readable explanation. Never claims more than is known. */
  message?: string;
  /** Contract revert reason, when the contract rejected the call. */
  revertReason?: string;
  startedAt?: number;
}

export const IDLE_TX: TxState = { phase: "IDLE" };

/**
 * The consensus-relevant fields of a GenLayer receipt.
 *
 * Field names are taken from genlayer-js 1.1.8 GenLayerTransaction, not
 * guessed: statusName is TransactionStatus, txExecutionResultName is
 * ExecutionResult, and consensus_data.final carries finality.
 */
export interface ReceiptSignals {
  statusName?: string;
  executionResultName?: string;
  consensusFinal?: boolean;
  numOfRounds?: string;
  rotationsLeft?: string;
  /** True when the receipt shows consensus was not reached. */
  undetermined: boolean;
  /** True when the contract itself errored. */
  executionErrored: boolean;
  /** True when the transaction reached a decided state at all. */
  decided: boolean;
}

/**
 * Statuses that mean consensus failed to settle on an outcome. Treat every one
 * of these as "nothing was committed", regardless of execution result.
 */
const UNDETERMINED_STATUSES = new Set([
  "UNDETERMINED",
  "CANCELED",
  "VALIDATORS_TIMEOUT",
  "LEADER_TIMEOUT",
]);

/** Statuses that mean the transaction settled and state may have been written. */
const DECIDED_STATUSES = new Set(["ACCEPTED", "FINALIZED"]);

export function readReceipt(tx: GenLayerTransaction | undefined): ReceiptSignals {
  const raw = (tx ?? {}) as Record<string, unknown>;
  const statusName =
    typeof raw.statusName === "string" ? raw.statusName : undefined;
  const executionResultName =
    typeof raw.txExecutionResultName === "string"
      ? raw.txExecutionResultName
      : undefined;

  const consensus = raw.consensus_data as { final?: boolean } | undefined;
  const lastRound = raw.lastRound as
    | { rotationsLeft?: string }
    | undefined;

  const undetermined = statusName ? UNDETERMINED_STATUSES.has(statusName) : false;
  const decided = statusName ? DECIDED_STATUSES.has(statusName) : false;
  const executionErrored = executionResultName === "FINISHED_WITH_ERROR";

  return {
    statusName,
    executionResultName,
    consensusFinal: consensus?.final,
    numOfRounds: typeof raw.numOfRounds === "string" ? raw.numOfRounds : undefined,
    rotationsLeft: lastRound?.rotationsLeft,
    undetermined,
    executionErrored,
    decided,
  };
}

/** Best-effort revert reason from a GenLayer receipt or thrown error. */
export function readRevertReason(source: unknown): string | undefined {
  if (!source) return undefined;
  const raw = source as Record<string, unknown>;
  const consensus = raw.consensus_data as
    | { leader_receipt?: Array<Record<string, unknown>> }
    | undefined;
  const leader = consensus?.leader_receipt?.[0];
  const err = leader?.["error"];
  if (typeof err === "string" && err.length > 0) return err;
  const msg = raw.message;
  if (typeof msg === "string" && msg.length > 0) return msg;
  return undefined;
}

/** Whether a thrown error is the user declining to sign. */
export function isUserRejection(error: unknown): boolean {
  const raw = error as { code?: number; message?: string } | undefined;
  if (!raw) return false;
  if (raw.code === 4001) return true;
  const message = (raw.message ?? "").toLowerCase();
  return (
    message.includes("user rejected") ||
    message.includes("user denied") ||
    message.includes("rejected the request")
  );
}

export const PHASE_COPY: Record<TxPhase, { title: string; detail: string }> = {
  IDLE: { title: "Ready", detail: "" },
  WALLET_REQUIRED: {
    title: "Wallet required",
    detail: "Connect a wallet to submit protocol transactions.",
  },
  WRONG_NETWORK: {
    title: "Wrong network",
    detail: "Switch to GenLayer StudioNet to submit this transaction.",
  },
  AWAITING_SIGNATURE: {
    title: "Awaiting signature",
    detail: "Confirm the transaction in your wallet.",
  },
  SUBMITTED: {
    title: "Submitted",
    detail:
      "The transaction was broadcast. This is not yet a result: nothing is committed until validators reach consensus.",
  },
  PROCESSING: {
    title: "Reaching consensus",
    detail:
      "Validators are proposing, committing and revealing. Adjudication transactions take longest because each one fetches evidence and runs the model.",
  },
  CONSENSUS_UNDETERMINED: {
    title: "Consensus undetermined",
    detail:
      "Validators did not agree, so no protocol state was committed. This is a consensus condition, not a verdict on your amendment. You may retry.",
  },
  STATE_REVALIDATING: {
    title: "Verifying on-chain state",
    detail:
      "Consensus settled. Re-reading the contract to confirm the change actually landed before reporting success.",
  },
  SUCCESS: {
    title: "Confirmed on-chain",
    detail: "Contract state was re-read and the expected change is present.",
  },
  EXECUTION_ERROR: {
    title: "Rejected by the contract",
    detail: "The protocol refused this call. Nothing changed.",
  },
  USER_REJECTED: {
    title: "Signature declined",
    detail: "The transaction was not sent.",
  },
  TIMEOUT: {
    title: "No result yet",
    detail:
      "No decided receipt arrived within the wait window. The transaction may still settle; re-read the record before retrying.",
  },
  STATE_MISMATCH: {
    title: "State did not change",
    detail:
      "The receipt looked settled, but re-reading the contract shows the expected change is absent. Treat this as a failure, not a success.",
  },
};
