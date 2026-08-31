/** Presentation helpers. No protocol logic lives here. */

import { GEN_DECIMALS, GEN_SYMBOL } from "./config";
import {
  FIELD_LABELS,
  type AmendableField,
  type BondStatus,
  type CaseStatus,
  type FinalDecision,
} from "./types";

export function shortAddress(address: string | undefined): string {
  if (!address || address.length < 10) return address ?? "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/** Render a wei-denominated GEN amount without floating point drift. */
export function formatGen(wei: string | bigint | undefined): string {
  if (wei === undefined || wei === "") return `0 ${GEN_SYMBOL}`;
  let value: bigint;
  try {
    value = typeof wei === "bigint" ? wei : BigInt(wei);
  } catch {
    return `${String(wei)} ${GEN_SYMBOL}`;
  }
  const base = 10n ** BigInt(GEN_DECIMALS);
  const whole = value / base;
  const fraction = value % base;
  if (fraction === 0n) return `${whole} ${GEN_SYMBOL}`;
  const padded = fraction.toString().padStart(GEN_DECIMALS, "0");
  const trimmed = padded.replace(/0+$/, "").slice(0, 6);
  return `${whole}.${trimmed} ${GEN_SYMBOL}`;
}

/** Parse a decimal GEN string into wei. Throws on anything malformed. */
export function parseGen(input: string): bigint {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Enter a positive number of GEN.");
  }
  const [wholeRaw, fractionRaw = ""] = trimmed.split(".");
  const fraction = fractionRaw.padEnd(GEN_DECIMALS, "0").slice(0, GEN_DECIMALS);
  return BigInt(wholeRaw ?? "0") * 10n ** BigInt(GEN_DECIMALS) + BigInt(fraction || "0");
}

export function formatTimestamp(seconds: number | undefined): string {
  if (!seconds) return "-";
  return new Date(seconds * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatDuration(seconds: number | undefined): string {
  if (!seconds) return "-";
  if (seconds % 86400 === 0) {
    const days = seconds / 86400;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${seconds} seconds`;
}

/** Seconds remaining until a unix deadline, or null when it has passed. */
export function remainingSeconds(deadline: number | undefined): number | null {
  if (!deadline) return null;
  const remaining = deadline - Math.floor(Date.now() / 1000);
  return remaining > 0 ? remaining : null;
}

export function formatCountdown(seconds: number | null): string {
  if (seconds === null) return "closed";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  if (minutes > 0) return `${minutes}m remaining`;
  return `${seconds}s remaining`;
}

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field as AmendableField] ?? field;
}

/**
 * Render an amendable field value for display. Bond amounts are wei; the rest
 * are plain values that should be shown exactly as the contract stores them.
 */
export function fieldValue(field: string, value: string): string {
  if (!value) return "-";
  if (field === "amendment_bond_requirement") return formatGen(value);
  if (field === "challenge_window_seconds" || field === "evidence_window_seconds") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? formatDuration(parsed) : value;
  }
  if (field.startsWith("allowed_spending_categories")) {
    try {
      const parsed = JSON.parse(value) as string[];
      return Array.isArray(parsed) ? parsed.join(", ") : value;
    } catch {
      return value;
    }
  }
  return value;
}

export const CASE_STATUS_COPY: Record<CaseStatus, string> = {
  DRAFT: "Draft, awaiting bond",
  EVIDENCE_OPEN: "Evidence open",
  EVIDENCE_FROZEN: "Evidence frozen",
  VERDICT_PROPOSED: "Verdict proposed",
  CHALLENGE_WINDOW: "Under challenge",
  DECIDED: "Decided",
  WITHDRAWN: "Withdrawn",
};

export const BOND_STATUS_COPY: Record<BondStatus, string> = {
  NONE: "No bond locked",
  LOCKED: "Locked",
  REFUNDABLE: "Refundable to proposer",
  SLASHABLE: "Slashable to treasury",
  PAYOUT_PENDING: "Payout emitted, awaiting confirmation",
  REFUNDED: "Refunded",
  SLASHED: "Slashed",
};

export type Tone = "neutral" | "positive" | "negative" | "caution" | "info";

export function decisionTone(decision: FinalDecision | string): Tone {
  if (decision === "ACCEPTED") return "positive";
  if (decision === "REJECTED") return "negative";
  if (decision === "INVALID") return "caution";
  return "neutral";
}

export function bondTone(status: BondStatus): Tone {
  if (status === "REFUNDED" || status === "REFUNDABLE") return "positive";
  if (status === "SLASHED" || status === "SLASHABLE") return "negative";
  if (status === "PAYOUT_PENDING") return "caution";
  if (status === "LOCKED") return "info";
  return "neutral";
}

export function dimensionTone(result: string): Tone {
  if (result === "PASS") return "positive";
  if (result === "FAIL") return "negative";
  if (result === "UNCLEAR") return "caution";
  return "neutral";
}
