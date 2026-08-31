import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { reads, revalidators, writes } from "../lib/contract";
import { useRead, useWriteFlow } from "../hooks/useContract";
import { fieldValue, fieldLabel, formatGen, formatTimestamp } from "../lib/format";
import {
  AMENDABLE_FIELDS,
  FIELD_HINTS,
  FIELD_LABELS,
  type AmendableField,
} from "../lib/types";
import {
  Card,
  DataList,
  EmptyState,
  ErrorNote,
  Field,
  Loading,
  Mono,
} from "../components/ui";
import { CaseStatusBadge } from "../components/protocol";
import { TransactionPanel, WriteGate } from "../components/TransactionPanel";

export function CaseExplorer() {
  const [params, setParams] = useSearchParams();
  const daoId = params.get("dao") ?? "";
  const [query, setQuery] = useState(daoId);

  const cases = useRead(
    () =>
      daoId
        ? reads.cases(daoId, 0, 50).catch(() => ({ total: 0, items: [] }))
        : Promise.resolve({ total: 0, items: [] }),
    [daoId],
    { enabled: Boolean(daoId) },
  );

  const [error, setError] = useState<string | null>(null);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const next = query.trim().toLowerCase();
    if (!next) {
      setError("Enter a DAO identifier first, for example: example-dao");
      setParams({});
      return;
    }
    setError(null);
    setParams({ dao: next });
  };

  return (
    <div className="page stack-loose">
      <div>
        <p className="eyebrow">Case explorer</p>
        <h1>Amendment cases</h1>
        <p className="lede">
          Cases are indexed per governance domain, because the contract keeps no
          global case list. Enter a DAO identifier to read its docket.
        </p>
      </div>

      <Card>
        <form onSubmit={onSubmit} className="row" style={{ alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 260px" }}>
            <Field label="DAO identifier" error={error ?? undefined}>
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  if (error) setError(null);
                }}
                placeholder="example-dao"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={error ? true : undefined}
              />
            </Field>
          </div>
          <button type="submit" className="btn btn-primary">
            Load cases
          </button>
          <Link className="btn" to="/cases/new">
            Open a case
          </Link>
        </form>
      </Card>

      {!daoId && (
        <EmptyState title="No domain selected">
          Enter a DAO identifier above to read its amendment cases.
        </EmptyState>
      )}

      {daoId && cases.loading && <Loading />}
      {daoId && cases.error && <ErrorNote error={cases.error} />}

      {daoId && !cases.loading && (cases.data?.items.length ?? 0) === 0 && (
        <EmptyState title="No cases on this docket">
          <span className="mono">{daoId}</span> has no amendment cases, or the
          identifier is not registered.
        </EmptyState>
      )}

      {(cases.data?.items.length ?? 0) > 0 && (
        <Card flush>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Field</th>
                  <th>Change</th>
                  <th>Status</th>
                  <th>Bond</th>
                  <th>Opened</th>
                </tr>
              </thead>
              <tbody>
                {cases.data?.items.map((record) => (
                  <tr key={record.case_id}>
                    <td>
                      <Link to={`/cases/${record.case_id}`}>{record.case_id}</Link>
                    </td>
                    <td className="small">{fieldLabel(record.target_field)}</td>
                    <td className="small mono">
                      {fieldValue(record.target_field, record.old_value)} &rarr;{" "}
                      {fieldValue(record.target_field, record.proposed_value)}
                    </td>
                    <td>
                      <CaseStatusBadge record={record} />
                    </td>
                    <td className="small">{formatGen(record.bond_amount)}</td>
                    <td className="small faint">
                      {formatTimestamp(record.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

export function NewCase() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [daoId, setDaoId] = useState(params.get("dao") ?? "");
  const [field, setField] = useState<AmendableField>("maximum_individual_allocation");
  const [proposed, setProposed] = useState("");
  const [rationale, setRationale] = useState("");
  const [caseCountBefore, setCaseCountBefore] = useState<number | null>(null);

  const policy = useRead(
    () => (daoId ? reads.currentPolicyOptional(daoId) : Promise.resolve(null)),
    [daoId],
    { enabled: Boolean(daoId) },
  );
  const dao = useRead(
    () => (daoId ? reads.daoOptional(daoId) : Promise.resolve(null)),
    [daoId],
    { enabled: Boolean(daoId) },
  );

  useEffect(() => {
    if (dao.data) setCaseCountBefore(dao.data.case_count);
  }, [dao.data]);

  const flow = useWriteFlow();

  const currentValue = useMemo(() => {
    const p = policy.data;
    if (!p) return "";
    switch (field) {
      case "maximum_individual_allocation":
        return String(p.maximum_individual_allocation);
      case "amendment_bond_requirement":
        return String(p.amendment_bond_requirement);
      case "challenge_window_seconds":
        return String(p.challenge_window_seconds);
      case "evidence_window_seconds":
        return String(p.evidence_window_seconds);
      case "minimum_evidence_count":
        return String(p.minimum_evidence_count);
      case "minimum_independent_sources":
        return String(p.minimum_independent_sources);
      default:
        return JSON.stringify(p.allowed_spending_categories);
    }
  }, [policy.data, field]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!daoId || caseCountBefore === null) return;
    const phase = await flow.run(
      writes.openAmendmentCase(daoId, field, proposed.trim(), rationale.trim()),
      revalidators.caseExists(daoId, caseCountBefore),
    );
    if (phase === "SUCCESS") {
      const refreshed = await reads.daoOptional(daoId);
      if (refreshed?.active_case_id) {
        navigate(`/cases/${refreshed.active_case_id}`);
      }
    }
  };

  return (
    <div className="page page-narrow stack-loose">
      <div>
        <p className="eyebrow">New case</p>
        <h1>Open an amendment case</h1>
        <p className="lede">
          A case proposes exactly one change to exactly one field. There is no
          way to bundle several changes: the contract takes a single field and a
          single value, so a proposal that mixes a reasonable change with a
          self-serving one cannot be constructed.
        </p>
      </div>

      <Card title="The case" eyebrow="Step 1">
        <form onSubmit={submit} className="stack">
          <Field label="DAO identifier" hint="The governance domain whose policy you are amending.">
            <input
              value={daoId}
              onChange={(event) => setDaoId(event.target.value.toLowerCase())}
              placeholder="example-dao"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>

          {daoId && policy.loading && <Loading label="Reading current policy" />}
          {daoId && !policy.loading && !policy.data && (
            <p className="field-error">
              No active policy found for that identifier.
            </p>
          )}

          <Field
            label="Field to amend"
            hint="One of the eight canonical amendable fields. Nothing else can be changed by amendment."
          >
            <select
              value={field}
              onChange={(event) => setField(event.target.value as AmendableField)}
            >
              {AMENDABLE_FIELDS.map((name) => (
                <option key={name} value={name}>
                  {FIELD_LABELS[name]}
                </option>
              ))}
            </select>
          </Field>

          {policy.data && (
            <DataList
              rows={[
                ["Current value", <Mono key="c">{fieldValue(field, currentValue)}</Mono>],
                [
                  "Required bond",
                  <strong key="b">
                    {formatGen(String(policy.data.amendment_bond_requirement))}
                  </strong>,
                ],
                [
                  "If rejected",
                  "the bond is slashed to the DAO treasury address frozen into this case",
                ],
              ]}
            />
          )}

          <Field label="Proposed value" hint={FIELD_HINTS[field]}>
            <input
              value={proposed}
              onChange={(event) => setProposed(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>

          <Field
            label="Rationale"
            hint="Up to 1500 characters. The adjudicator reads this alongside your evidence; a rationale that ignores alternatives or conflicts of interest will be graded accordingly."
          >
            <textarea
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
              maxLength={1500}
            />
          </Field>

          <WriteGate>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={flow.busy || !daoId || !proposed.trim() || !rationale.trim()}
            >
              {flow.busy ? "Submitting..." : "Open case"}
            </button>
          </WriteGate>

          <TransactionPanel state={flow.state} onRetry={flow.reset} />
        </form>
      </Card>

      <Card title="What happens next" eyebrow="After opening">
        <ol className="muted small" style={{ paddingLeft: "1.1rem", margin: 0 }}>
          <li>Lock the proposer bond in real GEN. The exact amount, or nothing.</li>
          <li>Submit evidence within the policy&rsquo;s evidence window.</li>
          <li>Freeze the evidence. After this, nothing can be added.</li>
          <li>Request adjudication. Sources are fetched on-chain and judged.</li>
          <li>Anyone but you may challenge the proposed verdict.</li>
          <li>Finalize. An accepted case mints a new policy version.</li>
          <li>Execute the payout, then confirm it once you have seen it land.</li>
        </ol>
      </Card>
    </div>
  );
}
