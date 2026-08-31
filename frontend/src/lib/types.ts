/**
 * Shapes returned by the Treasury Trial contract.
 *
 * Every public view returns a JSON string, so these describe the parsed
 * payloads. They mirror the contract's own records exactly; nothing here is
 * derived or embellished by the frontend.
 */

/** The 8 canonical amendable fields. One change per case, enforced on-chain. */
export const AMENDABLE_FIELDS = [
  "maximum_individual_allocation",
  "amendment_bond_requirement",
  "challenge_window_seconds",
  "evidence_window_seconds",
  "minimum_evidence_count",
  "minimum_independent_sources",
  "allowed_spending_categories.add",
  "allowed_spending_categories.remove",
] as const;
export type AmendableField = (typeof AMENDABLE_FIELDS)[number];

export const FIELD_LABELS: Record<AmendableField, string> = {
  maximum_individual_allocation: "Maximum individual allocation",
  amendment_bond_requirement: "Amendment bond requirement",
  challenge_window_seconds: "Challenge window",
  evidence_window_seconds: "Evidence window",
  minimum_evidence_count: "Minimum evidence count",
  minimum_independent_sources: "Minimum independent sources",
  "allowed_spending_categories.add": "Add a spending category",
  "allowed_spending_categories.remove": "Remove a spending category",
};

export const FIELD_HINTS: Record<AmendableField, string> = {
  maximum_individual_allocation:
    "Whole number in the policy reference currency, minor units. Must differ from the current value.",
  amendment_bond_requirement:
    "Whole number of GEN in wei. Must be greater than zero and differ from the current value.",
  challenge_window_seconds: "Between 3600 and 2592000 seconds.",
  evidence_window_seconds: "Between 3600 and 2592000 seconds.",
  minimum_evidence_count:
    "Between 1 and 8. Cannot fall below minimum independent sources.",
  minimum_independent_sources:
    "Between 0 and 8. Cannot exceed minimum evidence count.",
  "allowed_spending_categories.add":
    "One category, lowercase, not already present. The list may hold at most 24.",
  "allowed_spending_categories.remove":
    "One category that is currently present. At least one category must remain.",
};

/** The 8 frozen semantic dimensions the adjudicator grades. */
export const DIMENSIONS = [
  "MATERIAL_CHANGE_CONFIRMED",
  "POLICY_PURPOSE_CONSISTENT",
  "PROPORTIONAL_TO_NEED",
  "EVIDENCE_SUFFICIENT",
  "SOURCE_INDEPENDENCE",
  "REASONABLE_ALTERNATIVES_CONSIDERED",
  "CONFLICT_OF_INTEREST_CLEAR",
  "MANIPULATION_RISK_ACCEPTABLE",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const DIMENSION_QUESTIONS: Record<Dimension, string> = {
  MATERIAL_CHANGE_CONFIRMED:
    "Do verified sources show the real-world condition actually changed materially?",
  POLICY_PURPOSE_CONSISTENT:
    "Is the change consistent with the stated purpose and scope of the existing policy?",
  PROPORTIONAL_TO_NEED:
    "Is the magnitude of the change proportionate to the demonstrated need?",
  EVIDENCE_SUFFICIENT:
    "Does the evidence meet the frozen category, count and independence requirements in substance?",
  SOURCE_INDEPENDENCE:
    "Are the sources genuinely independent of the proposer and of each other?",
  REASONABLE_ALTERNATIVES_CONSIDERED:
    "Does the rationale address cheaper or narrower alternatives?",
  CONFLICT_OF_INTEREST_CLEAR:
    "Is the case free of visible proposer conflict of interest?",
  MANIPULATION_RISK_ACCEPTABLE:
    "Is there no strong signal of fabricated, coordinated or injection-laden evidence?",
};

export const EVIDENCE_CATEGORIES = [
  "MARKET_PRICING",
  "VENDOR_QUOTE",
  "SECURITY_INCIDENT",
  "INFRA_REQUIREMENT",
  "HISTORICAL_TREASURY_SPEND",
  "COMPARABLE_DAO_SPEND",
  "AUDIT_REPORT",
  "PUBLIC_DOCUMENTATION",
  "GOVERNANCE_RECORD",
  "REGULATORY_FILING",
  "OTHER_AUTHORITATIVE",
] as const;
export type EvidenceCategory = (typeof EVIDENCE_CATEGORIES)[number];

export const INDEPENDENCE_VALUES = [
  "INDEPENDENT",
  "AFFILIATED",
  "SELF_PUBLISHED",
  "UNKNOWN",
] as const;
export type IndependenceDeclaration = (typeof INDEPENDENCE_VALUES)[number];

export const CHALLENGE_GROUNDS = [
  "EVIDENCE_FABRICATED",
  "SOURCE_NOT_INDEPENDENT",
  "SAME_SOURCE_MULTIPLE_URLS",
  "CHANGE_NOT_MATERIAL",
  "DISPROPORTIONATE",
  "MULTI_CHANGE_SMUGGLED",
  "CONFLICT_OF_INTEREST",
  "INJECTION_IN_EVIDENCE",
  "POLICY_PURPOSE_VIOLATION",
] as const;
export type ChallengeGround = (typeof CHALLENGE_GROUNDS)[number];

export const CHALLENGE_GROUND_LABELS: Record<ChallengeGround, string> = {
  EVIDENCE_FABRICATED: "Evidence fabricated",
  SOURCE_NOT_INDEPENDENT: "Source not independent",
  SAME_SOURCE_MULTIPLE_URLS: "Same source under multiple URLs",
  CHANGE_NOT_MATERIAL: "Change not material",
  DISPROPORTIONATE: "Disproportionate",
  MULTI_CHANGE_SMUGGLED: "Multiple changes smuggled in",
  CONFLICT_OF_INTEREST: "Conflict of interest",
  INJECTION_IN_EVIDENCE: "Prompt injection in evidence",
  POLICY_PURPOSE_VIOLATION: "Policy purpose violation",
};

export type BondStatus =
  | "NONE"
  | "LOCKED"
  | "REFUNDABLE"
  | "SLASHABLE"
  | "PAYOUT_PENDING"
  | "REFUNDED"
  | "SLASHED";

export type CaseStatus =
  | "DRAFT"
  | "EVIDENCE_OPEN"
  | "EVIDENCE_FROZEN"
  | "VERDICT_PROPOSED"
  | "CHALLENGE_WINDOW"
  | "DECIDED"
  | "WITHDRAWN";

export type FinalDecision = "" | "ACCEPTED" | "REJECTED" | "INVALID";

export interface Policy {
  policy_id: string;
  dao_id: string;
  version: number;
  previous_policy_id: string;
  creator: string;
  treasury_address: string;
  title: string;
  description: string;
  allowed_spending_categories: string[];
  maximum_individual_allocation: number;
  reference_currency: string;
  amendment_bond_requirement: number;
  amendment_criteria: Dimension[];
  required_evidence_categories: EvidenceCategory[];
  minimum_evidence_count: number;
  minimum_independent_sources: number;
  challenge_window_seconds: number;
  evidence_window_seconds: number;
  created_at: number;
  status: "ACTIVE" | "SUPERSEDED";
  created_by_case_id: string;
  policy_hash: string;
}

export interface VerdictHistoryEntry {
  source: string;
  decision: string;
  reason: string;
  result?: string;
}

export interface AmendmentCase {
  case_id: string;
  dao_id: string;
  policy_id: string;
  policy_version: number;
  policy_hash: string;
  proposer: string;
  target_field: AmendableField;
  old_value: string;
  proposed_value: string;
  numeric_delta: string;
  rationale: string;
  frozen_criteria: Dimension[];
  frozen_required_categories: EvidenceCategory[];
  frozen_min_evidence: number;
  frozen_min_independent: number;
  frozen_challenge_window: number;
  frozen_evidence_window: number;
  treasury_address: string;
  bond_amount: string;
  created_at: number;
  evidence_window_ends: number;
  challenge_window_ends: number;
  status: CaseStatus;
  evidence_frozen: boolean;
  frozen_evidence_ids: string[];
  evidence_fingerprint: string;
  current_verdict_json: string;
  proposed_decision: FinalDecision;
  decision_reason: string;
  verdict_history: VerdictHistoryEntry[];
  final_decision: FinalDecision;
  resulting_policy_id: string;
  finalized_at: number;
}

export interface EvidenceRecord {
  evidence_id: string;
  case_id: string;
  challenge_id: string;
  submitter: string;
  category: EvidenceCategory;
  title: string;
  source_url: string;
  url_normalised: string;
  source_host: string;
  excerpt: string;
  claim: string;
  independence_declared: IndependenceDeclaration;
  affiliation_note: string;
  image_not_machine_verified: boolean;
  fetch_status: "NOT_ATTEMPTED" | "FETCHED" | "UNAVAILABLE";
  fetched_excerpt: string;
  submitted_at: number;
}

export interface ChallengeRecord {
  challenge_id: string;
  case_id: string;
  challenger: string;
  ground: ChallengeGround;
  statement: string;
  evidence_refs: string[];
  created_at: number;
  status: "OPEN" | "RESOLVED";
  result: "" | "UPHELD" | "PARTIAL" | "REJECTED";
  result_json: string;
  replacement_decision: string;
}

export interface Settlement {
  case_id: string;
  bond_status: BondStatus;
  amount: string;
  recipient: string;
  disposition: "" | "REFUND" | "SLASH";
  emitted_at: number;
  failed_attempts: number;
  last_error: string;
}

export interface DaoMeta {
  dao_id: string;
  controller: string;
  created_at: number;
  version_count: number;
  case_count: number;
  active_case_id: string;
  current_policy_id: string;
}

export interface ProtocolConfig {
  owner: string;
  paused: boolean;
  payout_in_flight: string;
  policy_count: number;
  case_count: number;
  evidence_count: number;
  challenge_count: number;
  amendable_fields: string[];
  dimensions: string[];
  evidence_categories: string[];
  challenge_grounds: string[];
}

/** Parsed adjudicator verdict, as validated on-chain before storage. */
export interface Verdict {
  outcome: "ACCEPT" | "REJECT" | "INVALID";
  invalid_reason: string;
  numeric_support: "NONE" | "PARTIAL" | "STRONG";
  dimensions: Record<
    Dimension,
    { result: "PASS" | "FAIL" | "UNCLEAR"; reason: string }
  >;
  decisive_evidence_ids: string[];
  unverified_evidence_ids: string[];
  manipulation_signals: string[];
  short_reason: string;
}

export interface CaseVerdictView {
  case_id: string;
  status: CaseStatus;
  proposed_decision: FinalDecision;
  final_decision: FinalDecision;
  decision_reason: string;
  verdict: string;
  history: VerdictHistoryEntry[];
  resulting_policy_id: string;
}

export interface Page<T> {
  total: number;
  items: T[];
}
