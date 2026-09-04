/**
 * The case chamber: one amendment case, in five views.
 *
 * Every write on these pages goes through useWriteFlow, so nothing here can
 * report success from a transaction hash. Each action names its own
 * revalidator, which is the only thing that turns a settled receipt into a
 * success state.
 */

import { useCallback, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import {
  MAX_CHALLENGES_PER_CASE,
  parseVerdict,
  reads,
  revalidators,
  writes,
} from "../lib/contract";
import { useRead, useWriteFlow } from "../hooks/useContract";
import { useWallet } from "../hooks/useWallet";
import {
  formatCountdown,
  formatDuration,
  formatGen,
  formatTimestamp,
  remainingSeconds,
} from "../lib/format";
import {
  CHALLENGE_GROUNDS,
  CHALLENGE_GROUND_LABELS,
  EVIDENCE_CATEGORIES,
  INDEPENDENCE_VALUES,
  type AmendmentCase,
  type ChallengeGround,
  type EvidenceCategory,
  type IndependenceDeclaration,
} from "../lib/types";
import {
  AddressLink,
  Badge,
  Card,
  DataList,
  EmptyState,
  ErrorNote,
  Field,
  Loading,
  Mono,
} from "../components/ui";
import {
  AmendmentDiff,
  BondPanel,
  CaseStatusBadge,
  ChallengeCard,
  EvidenceCard,
  VerdictPanel,
  VerdictTimeline,
} from "../components/protocol";
import { TransactionPanel, WriteGate } from "../components/TransactionPanel";

/* ------------------------------------------------------------------ */
/* Shared shell                                                        */
/* ------------------------------------------------------------------ */

const TABS = [
  { to: "", label: "Overview", end: true },
  { to: "evidence", label: "Evidence" },
  { to: "adjudication", label: "Adjudication" },
  { to: "challenge", label: "Challenges" },
  { to: "bond", label: "Bond" },
];

function CaseShell({
  caseId,
  record,
  children,
}: {
  caseId: string;
  record: AmendmentCase;
  children: ReactNode;
}) {
  return (
    <div className="page stack-loose">
      <div>
        <p className="eyebrow">
          <Link to={`/daos/${record.dao_id}`}>{record.dao_id}</Link> &middot; case
        </p>
        <h1>{record.case_id}</h1>
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <CaseStatusBadge record={record} />
          <Badge tone="neutral">Policy v{record.policy_version}</Badge>
          <Badge tone="neutral">Bond {formatGen(record.bond_amount)}</Badge>
        </div>
      </div>

      <nav className="subnav" aria-label="Case sections">
        {TABS.map((tab) => (
          <NavLink
            key={tab.label}
            end={tab.end}
            to={tab.to ? `/cases/${caseId}/${tab.to}` : `/cases/${caseId}`}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      {children}
    </div>
  );
}

function CaseFrame({
  children,
}: {
  children: (record: AmendmentCase, reload: () => void) => ReactNode;
}) {
  const { caseId = "" } = useParams();
  const state = useRead(() => reads.caseOptional(caseId), [caseId]);
  const reload = state.reload;

  if (state.loading) {
    return (
      <div className="page">
        <Loading />
      </div>
    );
  }
  if (state.error) {
    return (
      <div className="page">
        <ErrorNote error={state.error} />
      </div>
    );
  }
  if (!state.data) {
    return (
      <div className="page page-narrow">
        <EmptyState
          title="No such case"
          action={
            <Link className="btn" to="/cases">
              Back to the case explorer
            </Link>
          }
        >
          <span className="mono">{caseId}</span> does not exist on this
          deployment.
        </EmptyState>
      </div>
    );
  }

  return (
    <CaseShell caseId={caseId} record={state.data}>
      {children(state.data, reload)}
    </CaseShell>
  );
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

export function CaseChamber() {
  return (
    <CaseFrame>
      {(record, reload) => <ChamberBody record={record} reload={reload} />}
    </CaseFrame>
  );
}

function ChamberBody({
  record,
  reload,
}: {
  record: AmendmentCase;
  reload: () => void;
}) {
  const wallet = useWallet();
  const isProposer =
    wallet.account?.toLowerCase() === record.proposer.toLowerCase();
  const challenges = useRead(
    () => reads.caseChallenges(record.case_id),
    [record.case_id],
  );
  const withdraw = useWriteFlow(reload);
  const finalize = useWriteFlow(reload);

  const evidenceLeft = remainingSeconds(record.evidence_window_ends);
  const challengeLeft = remainingSeconds(record.challenge_window_ends);

  const canWithdraw =
    isProposer &&
    (record.status === "DRAFT" || record.status === "EVIDENCE_OPEN") &&
    !record.evidence_frozen;

  /*
   * finalize_case accepts VERDICT_PROPOSED as well as CHALLENGE_WINDOW, and
   * CHALLENGE_WINDOW is only ever set by open_challenge. Gating the button on
   * CHALLENGE_WINDOW alone made it unreachable for every uncontested case: the
   * verdict was in, the window had closed, and the UI offered nothing.
   */
  const awaitingFinalization =
    (record.status === "VERDICT_PROPOSED" ||
      record.status === "CHALLENGE_WINDOW") &&
    record.final_decision === "" &&
    record.proposed_decision !== "";

  const challengeList = challenges.data?.items ?? [];
  const openChallenge = challengeList.find((c) => c.status === "OPEN");
  // remainingSeconds() returns null for an elapsed deadline, never 0, so
  // "closed" is null-with-a-deadline-set, not a non-positive number.
  const windowClosed =
    record.challenge_window_ends > 0 && challengeLeft === null;
  const challengesExhausted = challengeList.length >= MAX_CHALLENGES_PER_CASE;

  const canFinalize =
    awaitingFinalization &&
    !openChallenge &&
    (windowClosed || challengesExhausted);

  return (
    <>
      <Card title="The proposed change" eyebrow="One field, one value">
        <AmendmentDiff record={record} />
      </Card>

      <Card title="Rationale" eyebrow="As submitted by the proposer">
        <p style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>
          {record.rationale}
        </p>
      </Card>

      <div className="grid grid-2">
        <Card title="Frozen at opening" eyebrow="Rules this case is judged under">
          <DataList
            rows={[
              ["Policy", <Mono key="p">{record.policy_id}</Mono>],
              ["Policy fingerprint", <Mono key="h">{record.policy_hash}</Mono>],
              [
                "Gating criteria",
                record.frozen_criteria.length > 0
                  ? record.frozen_criteria
                      .map((c) => c.replace(/_/g, " ").toLowerCase())
                      .join(", ")
                  : "none: no dimension can block this amendment",
              ],
              [
                "Required evidence categories",
                record.frozen_required_categories.length > 0
                  ? record.frozen_required_categories.join(", ")
                  : "none specified",
              ],
              [
                "Evidence requirement",
                `at least ${record.frozen_min_evidence} items, ${record.frozen_min_independent} independent`,
              ],
              ["Evidence window", formatDuration(record.frozen_evidence_window)],
              ["Challenge window", formatDuration(record.frozen_challenge_window)],
              ["Treasury", <AddressLink key="t" address={record.treasury_address} />],
            ]}
          />
          <p className="small muted" style={{ marginTop: "1rem", marginBottom: 0 }}>
            These were copied into the case when it opened. A later policy
            version cannot change how this case is judged.
          </p>
        </Card>

        <Card title="Where the case stands" eyebrow="Timing">
          <DataList
            rows={[
              ["Proposer", <AddressLink key="p" address={record.proposer} />],
              ["Opened", formatTimestamp(record.created_at)],
              [
                "Evidence window",
                record.evidence_frozen
                  ? "closed: evidence is frozen"
                  : formatCountdown(evidenceLeft),
              ],
              [
                "Challenge window",
                record.status === "CHALLENGE_WINDOW"
                  ? formatCountdown(challengeLeft)
                  : record.challenge_window_ends > 0
                    ? formatTimestamp(record.challenge_window_ends)
                    : "not started",
              ],
              [
                "Evidence on file",
                `${record.frozen_evidence_ids.length} frozen`,
              ],
              record.evidence_fingerprint
                ? [
                    "Evidence fingerprint",
                    <Mono key="f">{record.evidence_fingerprint}</Mono>,
                  ]
                : null,
              record.final_decision
                ? ["Finalized", formatTimestamp(record.finalized_at)]
                : null,
              record.resulting_policy_id
                ? [
                    "Resulting policy",
                    <Link key="rp" to={`/daos/${record.dao_id}/policy`}>
                      {record.resulting_policy_id}
                    </Link>,
                  ]
                : null,
            ]}
          />
        </Card>
      </div>

      <Card title="Verdict history" eyebrow="Append-only">
        <VerdictTimeline record={record} />
        {record.decision_reason && (
          <p className="small muted" style={{ marginTop: "1rem", marginBottom: 0 }}>
            Contract decision reason: <Mono>{record.decision_reason}</Mono>
          </p>
        )}
      </Card>

      {awaitingFinalization && !canFinalize && (
        <Card title="Not ready to finalize" eyebrow="Case control">
          <p className="small muted" style={{ marginBottom: 0 }}>
            {openChallenge
              ? `Challenge ${openChallenge.challenge_id} is still open. It must be resolved before this case can be finalized.`
              : `The challenge window is still open. Anyone but the proposer may dispute this verdict until it closes, in ${formatCountdown(challengeLeft)}.`}
          </p>
        </Card>
      )}

      {(canWithdraw || canFinalize) && (
        <Card title="Available actions" eyebrow="Case control">
          <div className="stack">
            {canWithdraw && (
              <div className="stack-tight">
                <p className="small muted" style={{ margin: 0 }}>
                  You opened this case and no evidence has been frozen. You may
                  withdraw it. A withdrawn case makes its bond refundable; it is
                  not a rejection.
                </p>
                <WriteGate>
                  <button
                    type="button"
                    className="btn"
                    disabled={withdraw.busy}
                    onClick={() =>
                      void withdraw.run(
                        writes.withdrawCase(record.case_id),
                        revalidators.caseStatusIs(record.case_id, ["WITHDRAWN"]),
                      )
                    }
                  >
                    {withdraw.busy ? "Withdrawing..." : "Withdraw case"}
                  </button>
                </WriteGate>
                <TransactionPanel state={withdraw.state} onRetry={withdraw.reset} />
              </div>
            )}

            {canFinalize && (
              <div className="stack-tight">
                <p className="small muted" style={{ margin: 0 }}>
                  The challenge window has elapsed. Finalizing writes the final
                  decision, mints a new policy version if the case was accepted,
                  and fixes where the bond goes.
                </p>
                <WriteGate>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={finalize.busy}
                    onClick={() =>
                      void finalize.run(
                        writes.finalizeCase(record.case_id),
                        revalidators.caseFinalized(record.case_id),
                      )
                    }
                  >
                    {finalize.busy ? "Finalizing..." : "Finalize case"}
                  </button>
                </WriteGate>
                <TransactionPanel state={finalize.state} onRetry={finalize.reset} />
              </div>
            )}
          </div>
        </Card>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

export function CaseEvidence() {
  return (
    <CaseFrame>
      {(record, reload) => <EvidenceBody record={record} reloadCase={reload} />}
    </CaseFrame>
  );
}

function EvidenceBody({
  record,
  reloadCase,
}: {
  record: AmendmentCase;
  reloadCase: () => void;
}) {
  const caseId = record.case_id;
  const list = useRead(
    () => reads.caseEvidence(caseId, 0, 50),
    [caseId],
  );
  const verdict = parseVerdict(record.current_verdict_json);
  const decisive = new Set(verdict?.decisive_evidence_ids ?? []);
  const unverified = new Set(verdict?.unverified_evidence_ids ?? []);

  const listReload = list.reload;
  const refresh = useCallback(() => {
    listReload();
    reloadCase();
  }, [listReload, reloadCase]);

  const submit = useWriteFlow(refresh);
  const freeze = useWriteFlow(refresh);

  const [category, setCategory] = useState<EvidenceCategory>("PUBLIC_DOCUMENTATION");
  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [claim, setClaim] = useState("");
  const [independence, setIndependence] =
    useState<IndependenceDeclaration>("INDEPENDENT");
  const [affiliation, setAffiliation] = useState("");

  const total = list.data?.total ?? 0;
  const open = record.status === "EVIDENCE_OPEN" && !record.evidence_frozen;
  const meetsCount = total >= record.frozen_min_evidence;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const phase = await submit.run(
      writes.submitEvidence({
        caseId,
        category,
        title: title.trim(),
        sourceUrl: sourceUrl.trim(),
        excerpt: excerpt.trim(),
        claim: claim.trim(),
        independenceDeclared: independence,
        affiliationNote: affiliation.trim(),
      }),
      revalidators.evidenceCountAtLeast(caseId, total + 1),
    );
    if (phase === "SUCCESS") {
      setTitle("");
      setSourceUrl("");
      setExcerpt("");
      setClaim("");
      setAffiliation("");
    }
  };

  return (
    <>
      <Card title="Evidence on file" eyebrow={`${total} submitted`}>
        <p className="small muted">
          Each source is fetched on-chain when adjudication runs. Validators must
          agree on the retrieved text before it reaches the adjudicator, and a
          source that cannot be fetched carries no evidentiary weight.
        </p>
        <DataList
          rows={[
            [
              "Requirement",
              `${record.frozen_min_evidence} items minimum, ${record.frozen_min_independent} independent`,
            ],
            [
              "Currently",
              meetsCount ? (
                <Badge key="ok" tone="positive">
                  count requirement met
                </Badge>
              ) : (
                <Badge key="no" tone="caution">
                  {record.frozen_min_evidence - total} more needed
                </Badge>
              ),
            ],
            [
              "Evidence state",
              record.evidence_frozen ? (
                <Badge key="f" tone="neutral">
                  frozen
                </Badge>
              ) : (
                <Badge key="o" tone="info">
                  open
                </Badge>
              ),
            ],
          ]}
        />
      </Card>

      {list.loading && <Loading />}
      {list.error && <ErrorNote error={list.error} onRetry={listReload} />}
      {!list.loading && !list.error && total === 0 && (
        <EmptyState title="No evidence submitted">
          Nothing has been filed on this case yet.
        </EmptyState>
      )}

      <div className="stack">
        {list.data?.items.map((item) => (
          <EvidenceCard
            key={item.evidence_id}
            record={item}
            decisive={decisive.has(item.evidence_id)}
            unverified={unverified.has(item.evidence_id)}
          />
        ))}
      </div>

      {open && (
        <Card title="Submit evidence" eyebrow="While the window is open">
          <form onSubmit={onSubmit} className="stack">
            <Field label="Category">
              <select
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as EvidenceCategory)
                }
              >
                {EVIDENCE_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {value.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Title">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>

            <Field
              label="Source URL"
              hint="A public page whose text can be retrieved on-chain. Anything unreachable is recorded as unverified."
            >
              <input
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                placeholder="https://"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>

            <Field
              label="Claim"
              hint="What this source establishes, in one sentence."
            >
              <input
                value={claim}
                onChange={(event) => setClaim(event.target.value)}
              />
            </Field>

            <Field
              label="Excerpt"
              hint="Your own quotation. It is stored but never trusted; only the on-chain fetch counts."
            >
              <textarea
                value={excerpt}
                onChange={(event) => setExcerpt(event.target.value)}
              />
            </Field>

            <Field
              label="Independence"
              hint="Declare honestly. A false declaration is itself a challenge ground."
            >
              <select
                value={independence}
                onChange={(event) =>
                  setIndependence(event.target.value as IndependenceDeclaration)
                }
              >
                {INDEPENDENCE_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Affiliation note"
              hint="Optional. Required in spirit if the source is not independent."
            >
              <input
                value={affiliation}
                onChange={(event) => setAffiliation(event.target.value)}
              />
            </Field>

            <WriteGate>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submit.busy || !title.trim() || !claim.trim()}
              >
                {submit.busy ? "Submitting..." : "Submit evidence"}
              </button>
            </WriteGate>
            <TransactionPanel state={submit.state} onRetry={submit.reset} />
          </form>
        </Card>
      )}

      {open && (
        <Card title="Freeze evidence" eyebrow="Irreversible">
          <p className="small muted">
            Freezing closes the record. After this nothing can be added, removed
            or edited, and the case becomes eligible for adjudication. The freeze
            is a separate committed transaction, which is why it survives even if
            a later adjudication attempt fails to reach consensus.
          </p>
          <WriteGate>
            <button
              type="button"
              className="btn"
              disabled={freeze.busy || !meetsCount}
              onClick={() =>
                void freeze.run(
                  writes.freezeEvidence(caseId),
                  revalidators.evidenceFrozen(caseId),
                )
              }
            >
              {freeze.busy ? "Freezing..." : "Freeze evidence"}
            </button>
          </WriteGate>
          {!meetsCount && (
            <p className="field-error">
              The frozen policy requires at least {record.frozen_min_evidence}{" "}
              items before the record can be closed.
            </p>
          )}
          <TransactionPanel state={freeze.state} onRetry={freeze.reset} />
        </Card>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Adjudication                                                        */
/* ------------------------------------------------------------------ */

export function CaseAdjudication() {
  return (
    <CaseFrame>
      {(record, reload) => <AdjudicationBody record={record} reload={reload} />}
    </CaseFrame>
  );
}

function AdjudicationBody({
  record,
  reload,
}: {
  record: AmendmentCase;
  reload: () => void;
}) {
  const caseId = record.case_id;
  const adjudicate = useWriteFlow(reload);
  const verdict = useMemo(
    () => parseVerdict(record.current_verdict_json),
    [record.current_verdict_json],
  );

  const eligible =
    record.evidence_frozen &&
    (record.status === "EVIDENCE_FROZEN" || record.status === "VERDICT_PROPOSED");

  return (
    <>
      <Card title="How this case is judged" eyebrow="Method">
        <p className="small muted" style={{ marginBottom: 0 }}>
          The adjudicator receives a deterministic dossier: the frozen change,
          the rationale, and the on-chain fetched text of each source, wrapped in
          untrusted-content markers. It grades eight dimensions and returns
          strict JSON. The contract validates that JSON against an exact schema
          and then computes the decision itself from the criteria this DAO froze.
          A model saying &ldquo;accept&rdquo; cannot pass a failed gate, and model
          uncertainty can never become an <code>INVALID</code> verdict.
        </p>
      </Card>

      {!verdict && (
        <EmptyState title="No verdict recorded">
          Adjudication has not produced a stored verdict for this case yet.
        </EmptyState>
      )}

      {verdict && (
        <Card title="Proposed verdict" eyebrow="As stored on-chain">
          <VerdictPanel
            verdict={verdict}
            gated={record.frozen_criteria}
            decisionReason={record.decision_reason}
          />
        </Card>
      )}

      {eligible && (
        <Card title="Request adjudication" eyebrow="Consensus operation">
          <p className="small muted">
            This transaction fetches every source and runs the graded evaluation
            under consensus. It is the most demanding call in the protocol, and
            it can end Undetermined: validators fail to agree, the protocol
            discards the attempted write, and nothing is recorded. That is a
            consensus condition, not a rejection of your amendment. If it
            happens, the evidence freeze is untouched and you can request
            adjudication again.
          </p>
          <WriteGate>
            <button
              type="button"
              className="btn btn-primary"
              disabled={adjudicate.busy}
              onClick={() =>
                void adjudicate.run(
                  writes.requestAdjudication(caseId),
                  revalidators.verdictRecorded(caseId),
                )
              }
            >
              {adjudicate.busy ? "Adjudicating..." : "Request adjudication"}
            </button>
          </WriteGate>
          <TransactionPanel state={adjudicate.state} onRetry={adjudicate.reset} />
          <p className="small faint" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
            Success here is confirmed by re-reading <code>get_verdict</code>, not
            by the value the transaction returned. A transaction that reports a
            decision while the stored case is still unchanged is reported as a
            failure, because that is what live testing on StudioNet actually
            produced.
          </p>
        </Card>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Challenges                                                          */
/* ------------------------------------------------------------------ */

export function CaseChallenge() {
  return (
    <CaseFrame>
      {(record, reload) => <ChallengeBody record={record} reloadCase={reload} />}
    </CaseFrame>
  );
}

function ChallengeBody({
  record,
  reloadCase,
}: {
  record: AmendmentCase;
  reloadCase: () => void;
}) {
  const caseId = record.case_id;
  const wallet = useWallet();
  const list = useRead(
    () => reads.caseChallenges(caseId),
    [caseId],
  );
  const listReload = list.reload;
  const refresh = useCallback(() => {
    listReload();
    reloadCase();
  }, [listReload, reloadCase]);

  const open = useWriteFlow(refresh);
  const resolve = useWriteFlow(refresh);

  const [ground, setGround] = useState<ChallengeGround>("EVIDENCE_FABRICATED");
  const [statement, setStatement] = useState("");
  const [refs, setRefs] = useState("");

  const isProposer =
    wallet.account?.toLowerCase() === record.proposer.toLowerCase();
  const windowLeft = remainingSeconds(record.challenge_window_ends);
  /*
   * open_challenge accepts VERDICT_PROPOSED too. Requiring CHALLENGE_WINDOW
   * here meant the form only appeared once somebody had already challenged,
   * which nobody could do through this UI.
   */
  const windowOpen =
    (record.status === "VERDICT_PROPOSED" ||
      record.status === "CHALLENGE_WINDOW") &&
    windowLeft !== null &&
    windowLeft > 0;

  const total = list.data?.total ?? 0;
  const unresolved = list.data?.items.filter((c) => c.status === "OPEN") ?? [];

  const onOpen = async (event: FormEvent) => {
    event.preventDefault();
    const evidenceRefs = refs
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const phase = await open.run(
      writes.openChallenge(caseId, ground, statement.trim(), evidenceRefs),
      revalidators.challengeCountAtLeast(caseId, total + 1),
    );
    if (phase === "SUCCESS") {
      setStatement("");
      setRefs("");
    }
  };

  return (
    <>
      <Card title="Challenges" eyebrow={`${total} raised`}>
        <p className="small muted" style={{ marginBottom: 0 }}>
          A challenge disputes the proposed verdict on a specific ground. The
          proposer cannot challenge their own case. Resolving a challenge re-runs
          the relevant part of the evaluation and may replace the proposed
          decision; the superseded entry stays visible in the verdict history.
        </p>
      </Card>

      {list.loading && <Loading />}
      {list.error && <ErrorNote error={list.error} onRetry={listReload} />}
      {!list.loading && !list.error && total === 0 && (
        <EmptyState title="No challenges">
          Nobody has disputed the proposed verdict on this case.
        </EmptyState>
      )}

      <div className="stack">
        {list.data?.items.map((item) => (
          <ChallengeCard key={item.challenge_id} record={item} />
        ))}
      </div>

      {unresolved.length > 0 && (
        <Card title="Resolve a challenge" eyebrow="Consensus operation">
          <div className="stack">
            {unresolved.map((item) => (
              <div key={item.challenge_id} className="row row-between">
                <span className="mono small">{item.challenge_id}</span>
                <WriteGate>
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={resolve.busy}
                    onClick={() =>
                      void resolve.run(
                        writes.resolveChallenge(caseId, item.challenge_id),
                        revalidators.challengeResolved(caseId, item.challenge_id),
                      )
                    }
                  >
                    {resolve.busy ? "Resolving..." : "Resolve"}
                  </button>
                </WriteGate>
              </div>
            ))}
            <TransactionPanel state={resolve.state} onRetry={resolve.reset} />
          </div>
        </Card>
      )}

      {windowOpen && !isProposer && (
        <Card
          title="Raise a challenge"
          eyebrow={`Window closes in ${formatCountdown(windowLeft)}`}
        >
          <form onSubmit={onOpen} className="stack">
            <Field label="Ground">
              <select
                value={ground}
                onChange={(event) =>
                  setGround(event.target.value as ChallengeGround)
                }
              >
                {CHALLENGE_GROUNDS.map((value) => (
                  <option key={value} value={value}>
                    {CHALLENGE_GROUND_LABELS[value]}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Statement"
              hint="What specifically is wrong, and how the record shows it."
            >
              <textarea
                value={statement}
                onChange={(event) => setStatement(event.target.value)}
                maxLength={1500}
              />
            </Field>
            <Field
              label="Cited evidence ids"
              hint="Optional, comma separated. Each must already be on this case."
            >
              <input
                value={refs}
                onChange={(event) => setRefs(event.target.value)}
                placeholder="e_1, e_2"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <WriteGate>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={open.busy || !statement.trim()}
              >
                {open.busy ? "Submitting..." : "Open challenge"}
              </button>
            </WriteGate>
            <TransactionPanel state={open.state} onRetry={open.reset} />
          </form>
        </Card>
      )}

      {windowOpen && isProposer && (
        <Card title="You cannot challenge your own case" eyebrow="Blocked on-chain">
          <p className="small muted" style={{ marginBottom: 0 }}>
            The contract rejects a challenge from the proposer address, so this
            form is not offered.
          </p>
        </Card>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Bond                                                                */
/* ------------------------------------------------------------------ */

export function CaseBond() {
  return (
    <CaseFrame>
      {(record, reload) => <BondBody record={record} reloadCase={reload} />}
    </CaseFrame>
  );
}

function BondBody({
  record,
  reloadCase,
}: {
  record: AmendmentCase;
  reloadCase: () => void;
}) {
  const caseId = record.case_id;
  const wallet = useWallet();
  const settlement = useRead(() => reads.bondStateOptional(caseId), [caseId]);
  const settlementReload = settlement.reload;
  const refresh = useCallback(() => {
    settlementReload();
    reloadCase();
  }, [settlementReload, reloadCase]);

  const lock = useWriteFlow(refresh);
  const payout = useWriteFlow(refresh);
  const confirm = useWriteFlow(refresh);

  const isProposer =
    wallet.account?.toLowerCase() === record.proposer.toLowerCase();
  const status = settlement.data?.bond_status ?? "NONE";
  const bondWei = useMemo(() => {
    try {
      return BigInt(record.bond_amount);
    } catch {
      return 0n;
    }
  }, [record.bond_amount]);

  const canLock = isProposer && status === "NONE" && record.status !== "WITHDRAWN";
  const canPayout = status === "REFUNDABLE" || status === "SLASHABLE";
  const canConfirm = status === "PAYOUT_PENDING";

  return (
    <>
      <Card title="Bond" eyebrow="Native GEN, held by the contract">
        {settlement.loading && <Loading />}
        {settlement.data && (
          <BondPanel settlement={settlement.data} record={record} />
        )}
        {!settlement.loading && !settlement.data && (
          <EmptyState title="No bond record">
            No bond has been locked against this case.
          </EmptyState>
        )}
      </Card>

      {canLock && (
        <Card title="Lock the proposer bond" eyebrow="Payable transaction">
          <DataList
            rows={[
              [
                "Amount required",
                <strong key="a">{formatGen(record.bond_amount)}</strong>,
              ],
              ["In wei", <Mono key="w">{record.bond_amount}</Mono>],
              [
                "What this is",
                "real native GEN transferred to the contract, not an accounting entry",
              ],
              [
                "If the case is rejected",
                <span key="s">
                  the bond is transferred to{" "}
                  <AddressLink address={record.treasury_address} />
                </span>,
              ],
            ]}
          />
          <p className="small muted">
            The contract requires this exact amount. Any other value is rejected,
            so there is no partial bond and no overpayment to reclaim.
          </p>
          <WriteGate>
            <button
              type="button"
              className="btn btn-primary"
              disabled={lock.busy || bondWei === 0n}
              onClick={() =>
                void lock.run(
                  writes.lockBond(caseId, bondWei),
                  revalidators.bondStatusIs(caseId, ["LOCKED"]),
                )
              }
            >
              {lock.busy ? "Locking..." : `Lock ${formatGen(record.bond_amount)}`}
            </button>
          </WriteGate>
          <TransactionPanel state={lock.state} onRetry={lock.reset} />
        </Card>
      )}

      {canPayout && (
        <Card title="Execute the payout" eyebrow="Two steps, deliberately">
          <p className="small muted">
            <code>execute_payout</code> takes only the case id. The recipient and
            the amount come from state frozen at finalization, so no caller can
            redirect the funds. The call emits the native transfer and moves the
            bond to <em>payout pending</em>.
          </p>
          <WriteGate>
            <button
              type="button"
              className="btn btn-primary"
              disabled={payout.busy}
              onClick={() =>
                void payout.run(
                  writes.executePayout(caseId),
                  revalidators.bondStatusIs(caseId, ["PAYOUT_PENDING"]),
                )
              }
            >
              {payout.busy ? "Executing..." : "Execute payout"}
            </button>
          </WriteGate>
          <TransactionPanel state={payout.state} onRetry={payout.reset} />
        </Card>
      )}

      {canConfirm && (
        <Card title="Confirm the payout" eyebrow="Only after you have seen it land">
          <p className="small muted">
            The bond is marked <em>payout pending</em>. Confirmation is a separate
            transaction on purpose: it is not called automatically just because
            the payout transaction returned, because a returned value is not
            evidence that GEN arrived. Check the recipient balance on the
            explorer first, then confirm.
          </p>
          <DataList
            rows={[
              [
                "Recipient",
                settlement.data?.recipient ? (
                  <AddressLink address={settlement.data.recipient} />
                ) : (
                  <span className="faint">-</span>
                ),
              ],
              ["Amount", formatGen(settlement.data?.amount ?? record.bond_amount)],
              [
                "Emitted",
                settlement.data?.emitted_at
                  ? formatTimestamp(settlement.data.emitted_at)
                  : "-",
              ],
            ]}
          />
          <WriteGate>
            <button
              type="button"
              className="btn"
              disabled={confirm.busy}
              onClick={() =>
                void confirm.run(
                  writes.confirmPayout(caseId),
                  revalidators.bondStatusIs(caseId, ["REFUNDED", "SLASHED"]),
                )
              }
            >
              {confirm.busy
                ? "Confirming..."
                : "I have verified the transfer, confirm"}
            </button>
          </WriteGate>
          <TransactionPanel state={confirm.state} onRetry={confirm.reset} />
        </Card>
      )}
    </>
  );
}
