/**
 * The one Treasury Trial contract adapter.
 *
 * Every read, write, receipt inspection and state revalidation goes through
 * here. Components never talk to genlayer-js directly, so the "submitted is
 * not success" rule cannot be bypassed by a component author who forgets it.
 *
 * ABI covered: 29 public methods, 15 writes (one payable) and 14 views.
 */

import { createClient } from "genlayer-js";
import type { GenLayerTransaction, Hash } from "genlayer-js/types";
import {
  CHAIN,
  CONTRACT_ADDRESS,
  RECEIPT_INTERVAL_MS,
  RECEIPT_RETRIES,
} from "./config";
import {
  isUserRejection,
  readReceipt,
  readRevertReason,
  type ReceiptSignals,
  type TxPhase,
} from "./txState";
import type {
  AmendableField,
  AmendmentCase,
  CaseVerdictView,
  ChallengeGround,
  ChallengeRecord,
  DaoMeta,
  EvidenceCategory,
  EvidenceRecord,
  IndependenceDeclaration,
  Page,
  Policy,
  ProtocolConfig,
  Settlement,
  Verdict,
} from "./types";

export type Address = `0x${string}`;

/** Injected EIP-1193 provider surface we rely on. */
export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: string,
    handler: (...args: unknown[]) => void,
  ) => void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

/* ------------------------------------------------------------------ */
/* Clients                                                             */
/* ------------------------------------------------------------------ */

let readClientCache: ReturnType<typeof createClient> | null = null;

/** Read-only client. Works with no wallet, so browsing never needs one. */
export function readClient() {
  if (!readClientCache) {
    readClientCache = createClient({ chain: CHAIN });
  }
  return readClientCache;
}

function writeClient(account: Address, provider: Eip1193Provider) {
  return createClient({
    chain: CHAIN,
    account,
    // genlayer-js accepts an EIP-1193 provider here; typed loosely upstream.
    provider: provider as never,
  });
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** Contract views all return a JSON string. */
async function readJson<T>(functionName: string, args: string[] = []): Promise<T> {
  const raw = await readClient().readContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args,
  });
  if (typeof raw !== "string") {
    throw new Error(`${functionName} returned a non-string payload`);
  }
  return JSON.parse(raw) as T;
}

/** A read that returns a bare string rather than JSON. */
async function readString(functionName: string, args: string[] = []): Promise<string> {
  const raw = await readClient().readContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args,
  });
  return String(raw);
}

/**
 * Reads that are expected to revert for unknown ids. Returns null instead of
 * throwing, so empty states render as empty rather than as errors.
 */
async function readOptional<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export const reads = {
  /** get_config() */
  config: () => readJson<ProtocolConfig>("get_config"),

  /** get_dao(dao_id) */
  dao: (daoId: string) => readJson<DaoMeta>("get_dao", [daoId]),
  daoOptional: (daoId: string) => readOptional(() => reads.dao(daoId)),

  /** get_dao_controller(dao_id) */
  daoController: (daoId: string) => readString("get_dao_controller", [daoId]),

  /** get_current_policy(dao_id) */
  currentPolicy: (daoId: string) => readJson<Policy>("get_current_policy", [daoId]),
  currentPolicyOptional: (daoId: string) =>
    readOptional(() => reads.currentPolicy(daoId)),

  /** get_policy(policy_id) */
  policy: (policyId: string) => readJson<Policy>("get_policy", [policyId]),
  policyOptional: (policyId: string) => readOptional(() => reads.policy(policyId)),

  /** get_policy_history(dao_id, offset, limit) */
  policyHistory: (daoId: string, offset = 0, limit = 50) =>
    readJson<Page<Policy>>("get_policy_history", [
      daoId,
      String(offset),
      String(limit),
    ]),

  /** get_case(case_id) */
  case: (caseId: string) => readJson<AmendmentCase>("get_case", [caseId]),
  caseOptional: (caseId: string) => readOptional(() => reads.case(caseId)),

  /** list_cases(dao_id, offset, limit) */
  cases: (daoId: string, offset = 0, limit = 50) =>
    readJson<Page<AmendmentCase>>("list_cases", [
      daoId,
      String(offset),
      String(limit),
    ]),

  /** get_evidence(evidence_id) */
  evidence: (evidenceId: string) =>
    readJson<EvidenceRecord>("get_evidence", [evidenceId]),

  /** get_case_evidence(case_id, offset, limit) */
  caseEvidence: (caseId: string, offset = 0, limit = 50) =>
    readJson<Page<EvidenceRecord>>("get_case_evidence", [
      caseId,
      String(offset),
      String(limit),
    ]),

  /** get_challenge(challenge_id) */
  challenge: (challengeId: string) =>
    readJson<ChallengeRecord>("get_challenge", [challengeId]),

  /** get_case_challenges(case_id) */
  caseChallenges: (caseId: string) =>
    readJson<Page<ChallengeRecord>>("get_case_challenges", [caseId]),

  /** get_bond_state(case_id) */
  bondState: (caseId: string) => readJson<Settlement>("get_bond_state", [caseId]),
  bondStateOptional: (caseId: string) => readOptional(() => reads.bondState(caseId)),

  /** get_verdict(case_id) */
  verdict: (caseId: string) => readJson<CaseVerdictView>("get_verdict", [caseId]),
  verdictOptional: (caseId: string) => readOptional(() => reads.verdict(caseId)),
};

/** Parse the nested verdict JSON a case carries, if any. */
export function parseVerdict(raw: string | undefined): Verdict | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Verdict;
  } catch {
    return null;
  }
}

/**
 * The contract's pagination cap. Asking for more than this reverts, which
 * readOptional would turn into an empty list: a DAO with a policy would render
 * as a DAO with none. Never request a larger page.
 */
export const PAGE_MAX = 50;

/**
 * Walk the append-only version chain for a DAO, newest first.
 * Falls back to an empty list when the DAO has no policy yet.
 */
export async function policyLineage(daoId: string): Promise<Policy[]> {
  const page = await readOptional(() => reads.policyHistory(daoId, 0, PAGE_MAX));
  return page?.items ?? [];
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

/** Every write method on the contract, with its argument order. */
export type WriteMethod =
  | "register_dao"
  | "create_policy"
  | "open_amendment_case"
  | "withdraw_case"
  | "lock_bond"
  | "submit_evidence"
  | "freeze_evidence"
  | "request_adjudication"
  | "open_challenge"
  | "resolve_challenge"
  | "finalize_case"
  | "execute_payout"
  | "confirm_payout"
  | "pause"
  | "unpause";

export interface WriteRequest {
  method: WriteMethod;
  args: string[];
  /** Native GEN in wei. Only lock_bond is payable; everything else sends 0. */
  value?: bigint;
}

export interface WriteContext {
  account: Address;
  provider: Eip1193Provider;
}

/**
 * A verification step run AFTER a settled receipt.
 *
 * It re-reads authoritative contract state and returns true only when the
 * expected mutation is present. This is the only thing that can produce
 * SUCCESS; the transaction's return value is deliberately ignored.
 */
export type Revalidator = () => Promise<boolean>;

export interface WriteOutcome {
  phase: TxPhase;
  hash?: string;
  receipt?: ReceiptSignals;
  revertReason?: string;
  error?: string;
}

/**
 * Submit a write and resolve it honestly.
 *
 * Flow, in order, with no shortcuts:
 *   sign -> broadcast -> await decided receipt -> inspect consensus
 *   -> re-read contract state -> only then SUCCESS.
 */
export async function submitWrite(
  ctx: WriteContext,
  request: WriteRequest,
  revalidate: Revalidator,
  onPhase?: (phase: TxPhase, hash?: string) => void,
): Promise<WriteOutcome> {
  const client = writeClient(ctx.account, ctx.provider);

  let hash: string;
  try {
    onPhase?.("AWAITING_SIGNATURE");
    const result = await client.writeContract({
      address: CONTRACT_ADDRESS,
      functionName: request.method,
      args: request.args,
      value: request.value ?? 0n,
    });
    hash = String(result);
  } catch (error) {
    if (isUserRejection(error)) {
      return { phase: "USER_REJECTED" };
    }
    return {
      phase: "EXECUTION_ERROR",
      error: (error as Error)?.message ?? "The wallet could not send this transaction.",
      revertReason: readRevertReason(error),
    };
  }

  onPhase?.("SUBMITTED", hash);
  onPhase?.("PROCESSING", hash);

  let tx: GenLayerTransaction;
  try {
    tx = await readClient().waitForTransactionReceipt({
      hash: hash as Hash,
      interval: RECEIPT_INTERVAL_MS,
      retries: RECEIPT_RETRIES,
    });
  } catch {
    return { phase: "TIMEOUT", hash };
  }

  const receipt = readReceipt(tx);

  // Consensus failed to settle. Nothing was committed. This is NOT a verdict.
  if (receipt.undetermined) {
    return { phase: "CONSENSUS_UNDETERMINED", hash, receipt };
  }

  // The contract itself refused the call.
  if (receipt.executionErrored) {
    return {
      phase: "EXECUTION_ERROR",
      hash,
      receipt,
      revertReason: readRevertReason(tx),
    };
  }

  // Never reached a decided state within the window.
  if (!receipt.decided) {
    return { phase: "TIMEOUT", hash, receipt };
  }

  // Decided, and execution reported a return. Still not success: verify.
  onPhase?.("STATE_REVALIDATING", hash);
  let confirmed = false;
  try {
    confirmed = await revalidate();
  } catch {
    confirmed = false;
  }

  if (!confirmed) {
    return { phase: "STATE_MISMATCH", hash, receipt };
  }

  return { phase: "SUCCESS", hash, receipt };
}

/* ------------------------------------------------------------------ */
/* Write builders, one per contract method                             */
/* ------------------------------------------------------------------ */

export const writes = {
  registerDao: (daoId: string): WriteRequest => ({
    method: "register_dao",
    args: [daoId],
  }),

  createPolicy: (input: {
    daoId: string;
    treasuryAddress: string;
    title: string;
    description: string;
    allowedCategories: string[];
    maximumIndividualAllocation: string;
    referenceCurrency: string;
    amendmentBondRequirement: string;
    amendmentCriteria: string[];
    requiredEvidenceCategories: string[];
    minimumEvidenceCount: string;
    minimumIndependentSources: string;
    challengeWindowSeconds: string;
    evidenceWindowSeconds: string;
  }): WriteRequest => ({
    method: "create_policy",
    args: [
      input.daoId,
      input.treasuryAddress,
      input.title,
      input.description,
      JSON.stringify(input.allowedCategories),
      input.maximumIndividualAllocation,
      input.referenceCurrency,
      input.amendmentBondRequirement,
      JSON.stringify(input.amendmentCriteria),
      JSON.stringify(input.requiredEvidenceCategories),
      input.minimumEvidenceCount,
      input.minimumIndependentSources,
      input.challengeWindowSeconds,
      input.evidenceWindowSeconds,
    ],
  }),

  openAmendmentCase: (
    daoId: string,
    targetField: AmendableField,
    proposedValue: string,
    rationale: string,
  ): WriteRequest => ({
    method: "open_amendment_case",
    args: [daoId, targetField, proposedValue, rationale],
  }),

  withdrawCase: (caseId: string): WriteRequest => ({
    method: "withdraw_case",
    args: [caseId],
  }),

  /** The only payable write. Value must equal the frozen bond exactly. */
  lockBond: (caseId: string, bondWei: bigint): WriteRequest => ({
    method: "lock_bond",
    args: [caseId],
    value: bondWei,
  }),

  submitEvidence: (input: {
    caseId: string;
    category: EvidenceCategory;
    title: string;
    sourceUrl: string;
    excerpt: string;
    claim: string;
    independenceDeclared: IndependenceDeclaration;
    affiliationNote: string;
  }): WriteRequest => ({
    method: "submit_evidence",
    args: [
      input.caseId,
      input.category,
      input.title,
      input.sourceUrl,
      input.excerpt,
      input.claim,
      input.independenceDeclared,
      input.affiliationNote,
    ],
  }),

  freezeEvidence: (caseId: string): WriteRequest => ({
    method: "freeze_evidence",
    args: [caseId],
  }),

  requestAdjudication: (caseId: string): WriteRequest => ({
    method: "request_adjudication",
    args: [caseId],
  }),

  openChallenge: (
    caseId: string,
    ground: ChallengeGround,
    statement: string,
    evidenceRefs: string[],
  ): WriteRequest => ({
    method: "open_challenge",
    args: [caseId, ground, statement, JSON.stringify(evidenceRefs)],
  }),

  resolveChallenge: (caseId: string, challengeId: string): WriteRequest => ({
    method: "resolve_challenge",
    args: [caseId, challengeId],
  }),

  finalizeCase: (caseId: string): WriteRequest => ({
    method: "finalize_case",
    args: [caseId],
  }),

  /** Takes only a case id. The recipient comes from frozen contract state. */
  executePayout: (caseId: string): WriteRequest => ({
    method: "execute_payout",
    args: [caseId],
  }),

  confirmPayout: (caseId: string): WriteRequest => ({
    method: "confirm_payout",
    args: [caseId],
  }),

  pause: (): WriteRequest => ({ method: "pause", args: [] }),
  unpause: (): WriteRequest => ({ method: "unpause", args: [] }),
};

/* ------------------------------------------------------------------ */
/* Revalidators: what "it actually happened" means per write           */
/* ------------------------------------------------------------------ */

export const revalidators = {
  daoRegistered: (daoId: string): Revalidator => async () => {
    const dao = await reads.daoOptional(daoId);
    return dao !== null && dao.dao_id === daoId;
  },

  policyCreated: (daoId: string): Revalidator => async () => {
    const policy = await reads.currentPolicyOptional(daoId);
    return policy !== null && policy.version >= 1;
  },

  caseExists: (daoId: string, before: number): Revalidator => async () => {
    const dao = await reads.daoOptional(daoId);
    return dao !== null && dao.case_count > before;
  },

  caseStatusIs:
    (caseId: string, expected: string[]): Revalidator =>
    async () => {
      const record = await reads.caseOptional(caseId);
      return record !== null && expected.includes(record.status);
    },

  bondStatusIs:
    (caseId: string, expected: string[]): Revalidator =>
    async () => {
      const bond = await reads.bondStateOptional(caseId);
      return bond !== null && expected.includes(bond.bond_status);
    },

  evidenceCountAtLeast:
    (caseId: string, count: number): Revalidator =>
    async () => {
      const page = await readOptional(() => reads.caseEvidence(caseId, 0, 50));
      return page !== null && page.total >= count;
    },

  evidenceFrozen: (caseId: string): Revalidator => async () => {
    const record = await reads.caseOptional(caseId);
    return record !== null && record.evidence_frozen === true;
  },

  /**
   * Adjudication committed. This is the revalidator that live testing proved
   * indispensable: the transaction returned "ACCEPTED" while the case remained
   * at EVIDENCE_FROZEN with an empty history.
   */
  verdictRecorded: (caseId: string): Revalidator => async () => {
    const view = await reads.verdictOptional(caseId);
    if (!view) return false;
    return (
      view.proposed_decision !== "" &&
      view.history.length > 0 &&
      view.status !== "EVIDENCE_FROZEN"
    );
  },

  challengeCountAtLeast:
    (caseId: string, count: number): Revalidator =>
    async () => {
      const page = await readOptional(() => reads.caseChallenges(caseId));
      return page !== null && page.total >= count;
    },

  challengeResolved:
    (caseId: string, challengeId: string): Revalidator =>
    async () => {
      const page = await readOptional(() => reads.caseChallenges(caseId));
      const found = page?.items.find((c) => c.challenge_id === challengeId);
      return found !== undefined && found.status === "RESOLVED";
    },

  caseFinalized: (caseId: string): Revalidator => async () => {
    const record = await reads.caseOptional(caseId);
    return (
      record !== null &&
      record.status === "DECIDED" &&
      record.final_decision !== ""
    );
  },

  pausedIs: (expected: boolean): Revalidator => async () => {
    const config = await reads.config();
    return config.paused === expected;
  },
};
