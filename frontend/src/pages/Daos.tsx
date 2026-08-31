import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { policyLineage, reads } from "../lib/contract";
import { useRead } from "../hooks/useContract";
import {
  formatDuration,
  formatGen,
  formatTimestamp,
} from "../lib/format";
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
import { CaseStatusBadge, PolicyLineage } from "../components/protocol";
import type { Policy } from "../lib/types";

/**
 * The contract has no global DAO enumeration, by design: there is no
 * "all DAOs" view and no unbounded collection to iterate. So the registry is a
 * lookup, and ids you have visited are remembered in this browser only. That
 * is a UI convenience, never protocol state; the records themselves are always
 * re-read from the contract.
 */
const RECENT_KEY = "treasury-chamber:recent-daos";

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function rememberDao(daoId: string): void {
  try {
    const next = [daoId, ...readRecent().filter((d) => d !== daoId)].slice(0, 12);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* Private browsing or blocked storage: the app works without it. */
  }
}

export function DaoRegistry() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => setRecent(readRecent()), []);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const daoId = query.trim().toLowerCase();
    if (daoId) navigate(`/daos/${encodeURIComponent(daoId)}`);
  };

  return (
    <div className="page page-narrow stack">
      <div>
        <p className="eyebrow">Registry</p>
        <h1>DAOs</h1>
        <p className="lede">
          Look up a governance domain by its identifier. The first address to
          register an id holds it permanently, and that is the whole of the
          claimant&rsquo;s power: they cannot edit a policy, decide a case, or
          move any GEN.
        </p>
      </div>

      <Card>
        <form onSubmit={onSubmit} className="stack-tight">
          <Field
            label="DAO identifier"
            hint="Lowercase letters, digits, dot, underscore and hyphen. For example: example-dao"
          >
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="example-dao"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <div className="row">
            <button type="submit" className="btn btn-primary">
              Open DAO
            </button>
            <Link className="btn" to="/daos/new">
              Register an identifier
            </Link>
          </div>
        </form>
      </Card>

      <Card title="Recently viewed" eyebrow="This browser only">
        {recent.length === 0 ? (
          <p className="muted small" style={{ marginBottom: 0 }}>
            Nothing viewed yet. The contract keeps no global list of DAOs, so
            there is no index to browse; look one up by identifier above.
          </p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
            {recent.map((daoId) => (
              <li key={daoId}>
                <Link to={`/daos/${encodeURIComponent(daoId)}`}>{daoId}</Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function PolicySummary({ policy }: { policy: Policy }) {
  return (
    <DataList
      rows={[
        ["Version", <Badge key="v" tone="positive">v{policy.version}</Badge>],
        ["Title", policy.title],
        ["Purpose", policy.description],
        ["Spending categories", policy.allowed_spending_categories.join(", ")],
        [
          "Maximum individual allocation",
          `${policy.maximum_individual_allocation} ${policy.reference_currency}`,
        ],
        ["Amendment bond", formatGen(String(policy.amendment_bond_requirement))],
        ["Treasury", <AddressLink key="t" address={policy.treasury_address} />],
        [
          "Gating criteria",
          `${policy.amendment_criteria.length} of 8: ${policy.amendment_criteria
            .map((c) => c.replace(/_/g, " ").toLowerCase())
            .join(", ")}`,
        ],
        [
          "Evidence requirement",
          `at least ${policy.minimum_evidence_count} items, ${policy.minimum_independent_sources} independent`,
        ],
        ["Evidence window", formatDuration(policy.evidence_window_seconds)],
        ["Challenge window", formatDuration(policy.challenge_window_seconds)],
        ["Fingerprint", <Mono key="h">{policy.policy_hash}</Mono>],
      ]}
    />
  );
}

export function DaoOverview() {
  const { daoId = "" } = useParams();
  const dao = useRead(() => reads.daoOptional(daoId), [daoId]);
  const policy = useRead(() => reads.currentPolicyOptional(daoId), [daoId]);
  const cases = useRead(
    () => reads.cases(daoId, 0, 50).catch(() => ({ total: 0, items: [] })),
    [daoId],
  );

  useEffect(() => {
    if (dao.data) rememberDao(daoId);
  }, [dao.data, daoId]);

  if (dao.loading) return <div className="page"><Loading /></div>;
  if (dao.error) return <div className="page"><ErrorNote error={dao.error} /></div>;

  if (!dao.data) {
    return (
      <div className="page page-narrow">
        <EmptyState
          title="No such DAO"
          action={
            <Link className="btn" to="/daos">
              Back to registry
            </Link>
          }
        >
          <span className="mono">{daoId}</span> has not been registered on this
          deployment.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="page stack-loose">
      <div>
        <p className="eyebrow">Governance domain</p>
        <h1>{dao.data.dao_id}</h1>
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <Badge tone="neutral">{dao.data.version_count} policy version(s)</Badge>
          <Badge tone="neutral">{dao.data.case_count} case(s)</Badge>
          {dao.data.active_case_id ? (
            <Badge tone="info">Active case {dao.data.active_case_id}</Badge>
          ) : (
            <Badge tone="neutral">No active case</Badge>
          )}
        </div>
      </div>

      <Card
        title="Current policy"
        eyebrow="Governing rules"
        actions={
          <Link className="btn btn-small" to={`/daos/${daoId}/policy`}>
            Version history
          </Link>
        }
      >
        {policy.loading && <Loading />}
        {!policy.loading && !policy.data && (
          <EmptyState title="No policy published">
            The controller has registered this identifier but has not yet created
            version 1.
          </EmptyState>
        )}
        {policy.data && <PolicySummary policy={policy.data} />}
      </Card>

      <Card title="Amendment cases" eyebrow="Case history">
        {cases.loading && <Loading />}
        {!cases.loading && (cases.data?.items.length ?? 0) === 0 && (
          <EmptyState title="No amendment cases">
            Nobody has proposed a change to this policy yet.
          </EmptyState>
        )}
        {(cases.data?.items.length ?? 0) > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Change</th>
                  <th>Status</th>
                  <th>Opened</th>
                </tr>
              </thead>
              <tbody>
                {cases.data?.items.map((record) => (
                  <tr key={record.case_id}>
                    <td>
                      <Link to={`/cases/${record.case_id}`}>{record.case_id}</Link>
                    </td>
                    <td className="small">
                      {record.target_field.replace(/_/g, " ")}
                    </td>
                    <td>
                      <CaseStatusBadge record={record} />
                    </td>
                    <td className="small faint">
                      {formatTimestamp(record.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Controller" eyebrow="Registration">
        <DataList
          rows={[
            ["Controller", <AddressLink key="c" address={dao.data.controller} />],
            ["Registered", formatTimestamp(dao.data.created_at)],
          ]}
        />
        <p className="small muted" style={{ marginTop: "1rem", marginBottom: 0 }}>
          Registration is squatting protection only. It asserts nothing about
          legal or governance ownership of any real organisation, and the
          controller has no power over cases, verdicts or funds.
        </p>
      </Card>
    </div>
  );
}

export function DaoPolicy() {
  const { daoId = "" } = useParams();
  const lineage = useRead(() => policyLineage(daoId), [daoId]);
  const reload = useCallback(() => lineage.reload(), [lineage]);

  return (
    <div className="page stack-loose">
      <div>
        <p className="eyebrow">
          <Link to={`/daos/${daoId}`}>{daoId}</Link>
        </p>
        <h1>Policy lineage</h1>
        <p className="lede">
          Each accepted amendment mints a new version. Superseded versions are
          never edited or removed, so the record of what the treasury was
          permitted to do at any point survives intact.
        </p>
      </div>

      {lineage.loading && <Loading />}
      {lineage.error && <ErrorNote error={lineage.error} />}
      {!lineage.loading && !lineage.error && (
        <>
          {(lineage.data?.length ?? 0) > 0 && (
            <Card
              title="Current policy in full"
              eyebrow={`Version ${lineage.data?.[0]?.version ?? ""}`}
              actions={
                <button type="button" className="btn btn-small" onClick={reload}>
                  Refresh
                </button>
              }
            >
              {lineage.data?.[0] && <PolicySummary policy={lineage.data[0]} />}
            </Card>
          )}

          <section className="stack">
            <h2>Version history</h2>
            <PolicyLineage versions={lineage.data ?? []} daoId={daoId} />
          </section>
        </>
      )}
    </div>
  );
}
