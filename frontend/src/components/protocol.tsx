/** Protocol-specific display components: lineage, evidence, verdict, bond. */

import { Link } from "react-router-dom";
import {
  BOND_STATUS_COPY,
  CASE_STATUS_COPY,
  bondTone,
  decisionTone,
  dimensionTone,
  fieldLabel,
  fieldValue,
  formatGen,
  formatTimestamp,
} from "../lib/format";
import {
  DIMENSIONS,
  DIMENSION_QUESTIONS,
  type AmendmentCase,
  type ChallengeRecord,
  type Dimension,
  type EvidenceRecord,
  type Policy,
  type Settlement,
  type Verdict,
} from "../lib/types";
import { AddressLink, Badge, Card, DataList, EmptyState, Mono } from "./ui";

/* ---------------- policy lineage ---------------- */

/**
 * Immutable version history. Superseded versions are never hidden or
 * visually replaced; they remain inspectable, which is the point.
 */
export function PolicyLineage({
  versions,
  daoId,
}: {
  versions: Policy[];
  daoId: string;
}) {
  if (versions.length === 0) {
    return (
      <EmptyState title="No policy yet">
        This DAO has registered but has not published a treasury policy.
      </EmptyState>
    );
  }

  return (
    <div className="lineage">
      {versions.map((policy) => (
        <article
          className="lineage-node"
          key={policy.policy_id}
          data-current={policy.status === "ACTIVE"}
        >
          <div className="row row-between" style={{ marginBottom: "0.5rem" }}>
            <h4>
              Version {policy.version}{" "}
              <span className="faint mono small">{policy.policy_id}</span>
            </h4>
            <Badge tone={policy.status === "ACTIVE" ? "positive" : "neutral"}>
              {policy.status === "ACTIVE" ? "Current" : "Superseded"}
            </Badge>
          </div>
          <DataList
            rows={[
              ["Created", formatTimestamp(policy.created_at)],
              [
                "Predecessor",
                policy.previous_policy_id ? (
                  <Mono>{policy.previous_policy_id}</Mono>
                ) : (
                  <span className="faint">none, this is the original</span>
                ),
              ],
              [
                "Created by case",
                policy.created_by_case_id ? (
                  <Link to={`/cases/${policy.created_by_case_id}`}>
                    {policy.created_by_case_id}
                  </Link>
                ) : (
                  <span className="faint">founding policy, no case</span>
                ),
              ],
              ["Spending categories", policy.allowed_spending_categories.join(", ")],
              [
                "Maximum allocation",
                `${policy.maximum_individual_allocation} ${policy.reference_currency}`,
              ],
              ["Amendment bond", formatGen(String(policy.amendment_bond_requirement))],
              ["Fingerprint", <Mono key="h">{policy.policy_hash}</Mono>],
            ]}
          />
          <p className="small faint" style={{ marginTop: "0.75rem" }}>
            <Link to={`/daos/${daoId}/policy`}>Inspect full version</Link>
          </p>
        </article>
      ))}
    </div>
  );
}

/** The single change a case proposes, old beside new. */
export function AmendmentDiff({ record }: { record: AmendmentCase }) {
  return (
    <div className="stack-tight">
      <p className="eyebrow">{fieldLabel(record.target_field)}</p>
      <div className="diffbox">
        <div>
          <p className="eyebrow">Current</p>
          <p className="mono" style={{ margin: 0 }}>
            {fieldValue(record.target_field, record.old_value)}
          </p>
        </div>
        <span className="arrow" aria-hidden="true">
          &rarr;
        </span>
        <div>
          <p className="eyebrow">Proposed</p>
          <p className="mono" style={{ margin: 0 }}>
            {fieldValue(record.target_field, record.proposed_value)}
          </p>
        </div>
      </div>
      {record.numeric_delta && (
        <p className="small muted">
          Computed on-chain from the frozen values: {record.numeric_delta}. This is
          a fact about the proposal, not a claim about the world.
        </p>
      )}
    </div>
  );
}

/* ---------------- evidence ---------------- */

export function EvidenceCard({
  record,
  decisive,
  unverified,
}: {
  record: EvidenceRecord;
  decisive?: boolean;
  unverified?: boolean;
}) {
  const fetched = record.fetch_status === "FETCHED";
  return (
    <article className="evidence-card">
      <div className="evidence-head stack-tight">
        <div className="row row-between">
          <p className="eyebrow" style={{ margin: 0 }}>
            {record.category.replace(/_/g, " ")}
          </p>
          <div className="row" style={{ gap: "0.375rem" }}>
            {decisive && <Badge tone="info">Decisive</Badge>}
            {unverified && <Badge tone="caution">Unverified</Badge>}
            <Badge tone={fetched ? "positive" : "caution"}>
              {fetched ? "Fetched on-chain" : record.fetch_status.replace(/_/g, " ")}
            </Badge>
          </div>
        </div>
        <h4>{record.title}</h4>
        <p className="small muted" style={{ margin: 0 }}>
          {record.claim}
        </p>
      </div>

      <div className="evidence-body stack-tight">
        <DataList
          rows={[
            ["Evidence id", <Mono key="i">{record.evidence_id}</Mono>],
            [
              "Source",
              record.source_url ? (
                <a href={record.source_url} target="_blank" rel="noreferrer noopener">
                  {record.source_url}
                </a>
              ) : (
                <span className="faint">text only, no URL</span>
              ),
            ],
            [
              "Normalised host",
              record.source_host ? <Mono key="h">{record.source_host}</Mono> : "-",
            ],
            ["Submitted by", <AddressLink key="s" address={record.submitter} />],
            [
              "Independence",
              <span key="ind">
                <Badge
                  tone={
                    record.independence_declared === "INDEPENDENT" ? "info" : "caution"
                  }
                >
                  {record.independence_declared}
                </Badge>{" "}
                {record.affiliation_note && (
                  <span className="small muted">{record.affiliation_note}</span>
                )}
              </span>,
            ],
            ["Submitted", formatTimestamp(record.submitted_at)],
            record.challenge_id
              ? ["Challenge-scoped", <Mono key="c">{record.challenge_id}</Mono>]
              : null,
          ]}
        />

        <details>
          <summary className="small">Submitter excerpt (unverified)</summary>
          <p className="excerpt" style={{ marginTop: "0.5rem" }}>
            {record.excerpt || "No excerpt supplied."}
          </p>
        </details>

        {fetched && (
          <details>
            <summary className="small">
              Fetched source text, retrieved on-chain
            </summary>
            <p className="excerpt untrusted" style={{ marginTop: "0.5rem" }}>
              {record.fetched_excerpt}
            </p>
            <p className="small faint">
              Fetched by validators under a strict equality principle and passed
              to the adjudicator inside untrusted-content markers. The adjudicator
              is instructed to treat it as data, never as instructions.
            </p>
          </details>
        )}

        {!fetched && (
          <p className="small muted">
            This source was not retrievable on-chain, so it is unverified and
            cannot count toward the independent-source requirement.
          </p>
        )}

        {record.image_not_machine_verified && (
          <p className="small faint">
            V1 limitation: an image is never machine-verified. Only the fetched
            text of a linked public page carries evidentiary weight.
          </p>
        )}
      </div>
    </article>
  );
}

/* ---------------- verdict ---------------- */

export function VerdictPanel({
  verdict,
  gated,
  decisionReason,
}: {
  verdict: Verdict;
  gated: Dimension[];
  decisionReason?: string;
}) {
  const gatedSet = new Set(gated);
  return (
    <div className="stack">
      <div className="row" style={{ gap: "0.5rem" }}>
        <Badge tone={decisionTone(verdict.outcome === "ACCEPT" ? "ACCEPTED" : verdict.outcome === "REJECT" ? "REJECTED" : "INVALID")}>
          Model outcome: {verdict.outcome}
        </Badge>
        <Badge tone="neutral">Numeric support: {verdict.numeric_support}</Badge>
        {verdict.invalid_reason && (
          <Badge tone="caution">{verdict.invalid_reason}</Badge>
        )}
      </div>

      <p>{verdict.short_reason}</p>

      {decisionReason && (
        <p className="small muted">
          Contract decision reason: <Mono>{decisionReason}</Mono>
        </p>
      )}

      <div>
        <p className="eyebrow">Semantic dimensions</p>
        <p className="small muted">
          All eight are graded. Only the dimensions the DAO froze into its policy
          can block an amendment; those are marked as gating.
        </p>
        <div>
          {DIMENSIONS.map((dimension) => {
            const entry = verdict.dimensions[dimension];
            if (!entry) return null;
            const isGated = gatedSet.has(dimension);
            return (
              <div className="dimension" key={dimension}>
                <div>
                  <p style={{ margin: 0, fontWeight: 600 }}>
                    {dimension.replace(/_/g, " ")}{" "}
                    {isGated && (
                      <span className="small faint">(gating)</span>
                    )}
                  </p>
                  <p className="small faint" style={{ margin: "0.125rem 0 0.25rem" }}>
                    {DIMENSION_QUESTIONS[dimension]}
                  </p>
                  <p className="small muted" style={{ margin: 0 }}>
                    {entry.reason}
                  </p>
                </div>
                <Badge tone={dimensionTone(entry.result)}>{entry.result}</Badge>
              </div>
            );
          })}
        </div>
      </div>

      {(verdict.decisive_evidence_ids.length > 0 ||
        verdict.unverified_evidence_ids.length > 0 ||
        verdict.manipulation_signals.length > 0) && (
        <DataList
          rows={[
            verdict.decisive_evidence_ids.length > 0
              ? ["Decisive evidence", verdict.decisive_evidence_ids.join(", ")]
              : null,
            verdict.unverified_evidence_ids.length > 0
              ? ["Unverified evidence", verdict.unverified_evidence_ids.join(", ")]
              : null,
            verdict.manipulation_signals.length > 0
              ? ["Manipulation signals", verdict.manipulation_signals.join("; ")]
              : null,
          ]}
        />
      )}
    </div>
  );
}

/** Append-only verdict history. Nothing is ever overwritten visually. */
export function VerdictTimeline({ record }: { record: AmendmentCase }) {
  if (record.verdict_history.length === 0) {
    return <p className="muted small">No verdict has been recorded yet.</p>;
  }
  const last = record.verdict_history.length - 1;
  return (
    <div className="timeline">
      {record.verdict_history.map((entry, index) => (
        <div
          className="timeline-item"
          key={`${entry.source}-${index}`}
          data-superseded={index !== last}
        >
          <div className="row" style={{ gap: "0.5rem" }}>
            <Badge tone={decisionTone(entry.decision)}>{entry.decision}</Badge>
            {entry.result && <Badge tone="neutral">Challenge {entry.result}</Badge>}
            {index !== last && <span className="small faint">superseded</span>}
          </div>
          <p className="small muted" style={{ margin: "0.375rem 0 0" }}>
            {entry.source}
            {entry.reason ? ` - ${entry.reason}` : ""}
          </p>
        </div>
      ))}
    </div>
  );
}

export function ChallengeCard({ record }: { record: ChallengeRecord }) {
  return (
    <Card
      eyebrow={record.ground.replace(/_/g, " ")}
      title={record.challenge_id}
      actions={
        <Badge tone={record.status === "OPEN" ? "caution" : "neutral"}>
          {record.status}
        </Badge>
      }
    >
      <div className="stack-tight">
        <p>{record.statement}</p>
        <DataList
          rows={[
            ["Challenger", <AddressLink key="c" address={record.challenger} />],
            ["Raised", formatTimestamp(record.created_at)],
            [
              "Cited evidence",
              record.evidence_refs.length > 0
                ? record.evidence_refs.join(", ")
                : "none",
            ],
            record.result
              ? [
                  "Result",
                  <Badge key="r" tone={record.result === "REJECTED" ? "neutral" : "info"}>
                    {record.result}
                  </Badge>,
                ]
              : null,
            record.replacement_decision
              ? ["Replacement decision", record.replacement_decision]
              : null,
          ]}
        />
      </div>
    </Card>
  );
}

/* ---------------- bond ---------------- */

export function BondPanel({
  settlement,
  record,
}: {
  settlement: Settlement;
  record: AmendmentCase;
}) {
  const status = settlement.bond_status;
  return (
    <div className="stack">
      <div className="row row-between">
        <div>
          <p className="eyebrow">Proposer bond, real native GEN</p>
          <h3>{formatGen(settlement.amount !== "0" ? settlement.amount : record.bond_amount)}</h3>
        </div>
        <Badge tone={bondTone(status)}>{BOND_STATUS_COPY[status]}</Badge>
      </div>

      <DataList
        rows={[
          [
            "Recipient",
            settlement.recipient ? (
              <AddressLink address={settlement.recipient} />
            ) : (
              <span className="faint">not determined until finalization</span>
            ),
          ],
          [
            "Disposition",
            settlement.disposition ? settlement.disposition : "pending decision",
          ],
          ["Frozen treasury", <AddressLink key="t" address={record.treasury_address} />],
          ["Proposer", <AddressLink key="p" address={record.proposer} />],
          settlement.failed_attempts > 0
            ? ["Failed payout attempts", String(settlement.failed_attempts)]
            : null,
          settlement.last_error ? ["Last error", settlement.last_error] : null,
        ]}
      />

      <div className="card" style={{ background: "var(--paper-sunk)" }}>
        <p className="eyebrow">How disposition is decided</p>
        <p className="small muted" style={{ marginBottom: 0 }}>
          The contract sets the recipient at finalization and freezes it.{" "}
          <strong>Accepted</strong> and <strong>invalid</strong> cases are
          refundable to the proposer; only a substantive <strong>rejection</strong>{" "}
          is slashable to the DAO treasury. <code>execute_payout</code> takes only
          a case id, so no caller, including the contract owner, can redirect
          where the GEN goes.
        </p>
      </div>
    </div>
  );
}

export function CaseStatusBadge({ record }: { record: AmendmentCase }) {
  const decision = record.final_decision || record.proposed_decision;
  return (
    <div className="row" style={{ gap: "0.5rem" }}>
      <Badge tone="neutral">{CASE_STATUS_COPY[record.status]}</Badge>
      {decision && (
        <Badge tone={decisionTone(decision)}>
          {record.final_decision ? "Final" : "Proposed"}: {decision}
        </Badge>
      )}
    </div>
  );
}
