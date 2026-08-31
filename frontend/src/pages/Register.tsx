/**
 * Registration and policy creation.
 *
 * These are the two writes that bring a governance domain into existence. Both
 * re-read contract state before they will report success: registering re-reads
 * get_dao, and creating a policy re-reads get_current_policy.
 */

import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { reads, revalidators, writes } from "../lib/contract";
import { useRead, useWriteFlow } from "../hooks/useContract";
import { formatGen, parseGen } from "../lib/format";
import { DIMENSIONS, EVIDENCE_CATEGORIES, type Dimension, type EvidenceCategory } from "../lib/types";
import { Card, DataList, Field, Loading, Mono } from "../components/ui";
import { TransactionPanel, WriteGate } from "../components/TransactionPanel";

const ID_PATTERN = /^[a-z0-9._-]{3,48}$/;

export function RegisterDao() {
  const navigate = useNavigate();
  const [daoId, setDaoId] = useState("");
  const flow = useWriteFlow();

  const valid = ID_PATTERN.test(daoId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const phase = await flow.run(
      writes.registerDao(daoId),
      revalidators.daoRegistered(daoId),
    );
    if (phase === "SUCCESS") {
      navigate(`/daos/${encodeURIComponent(daoId)}/policy/new`);
    }
  };

  return (
    <div className="page page-narrow stack-loose">
      <div>
        <p className="eyebrow">Registry</p>
        <h1>Register a DAO identifier</h1>
        <p className="lede">
          The first address to claim an identifier holds it permanently. That is
          the whole of the claim: it prevents someone else taking the name, and
          it grants no power over cases, verdicts or funds.
        </p>
      </div>

      <Card title="Claim an identifier" eyebrow="One transaction">
        <form onSubmit={submit} className="stack">
          <Field
            label="DAO identifier"
            hint="3 to 48 characters: lowercase letters, digits, dot, underscore, hyphen."
            error={daoId && !valid ? "That identifier does not match the on-chain format." : undefined}
          >
            <input
              value={daoId}
              onChange={(event) => setDaoId(event.target.value.toLowerCase())}
              placeholder="example-dao"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <WriteGate>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={flow.busy || !valid}
            >
              {flow.busy ? "Registering..." : "Register"}
            </button>
          </WriteGate>
          <TransactionPanel state={flow.state} onRetry={flow.reset} />
        </form>
      </Card>

      <Card title="What registration is not" eyebrow="Stated plainly">
        <p className="small muted" style={{ marginBottom: 0 }}>
          Claiming an identifier is squatting protection. It is not a claim to
          represent any real organisation, and this protocol makes no attempt to
          verify one. Anyone reading a policy here should judge it by its
          contents and its address, not by its name.
        </p>
      </Card>
    </div>
  );
}

export function CreatePolicy() {
  const { daoId = "" } = useParams();
  const navigate = useNavigate();
  const dao = useRead(() => reads.daoOptional(daoId), [daoId]);
  const flow = useWriteFlow();

  const [treasury, setTreasury] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categories, setCategories] = useState("grants, events, infrastructure");
  const [maxAllocation, setMaxAllocation] = useState("50000");
  const [currency, setCurrency] = useState("USD");
  const [bond, setBond] = useState("1");
  const [criteria, setCriteria] = useState<Dimension[]>([
    "MATERIAL_CHANGE_CONFIRMED",
    "POLICY_PURPOSE_CONSISTENT",
    "PROPORTIONAL_TO_NEED",
    "EVIDENCE_SUFFICIENT",
    "SOURCE_INDEPENDENCE",
    "MANIPULATION_RISK_ACCEPTABLE",
  ]);
  const [requiredCategories, setRequiredCategories] = useState<EvidenceCategory[]>([]);
  const [minEvidence, setMinEvidence] = useState("2");
  const [minIndependent, setMinIndependent] = useState("1");
  const [challengeWindow, setChallengeWindow] = useState("3600");
  const [evidenceWindow, setEvidenceWindow] = useState("3600");

  const toggle = <T,>(list: T[], value: T, set: (next: T[]) => void) => {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  let bondWei = 0n;
  let bondError: string | undefined;
  try {
    bondWei = parseGen(bond);
    if (bondWei <= 0n) bondError = "The bond must be greater than zero.";
  } catch {
    bondError = "Enter a decimal amount of GEN, for example 1 or 0.5.";
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await flow.run(
      writes.createPolicy({
        daoId,
        treasuryAddress: treasury.trim(),
        title: title.trim(),
        description: description.trim(),
        allowedCategories: categories
          .split(",")
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean),
        maximumIndividualAllocation: maxAllocation.trim(),
        referenceCurrency: currency.trim().toUpperCase(),
        amendmentBondRequirement: bondWei.toString(),
        amendmentCriteria: criteria,
        requiredEvidenceCategories: requiredCategories,
        minimumEvidenceCount: minEvidence.trim(),
        minimumIndependentSources: minIndependent.trim(),
        challengeWindowSeconds: challengeWindow.trim(),
        evidenceWindowSeconds: evidenceWindow.trim(),
      }),
      revalidators.policyCreated(daoId),
    );
  };

  if (dao.loading) {
    return (
      <div className="page">
        <Loading />
      </div>
    );
  }

  return (
    <div className="page page-narrow stack-loose">
      <div>
        <p className="eyebrow">{daoId}</p>
        <h1>Publish a treasury policy</h1>
        <p className="lede">
          A policy is frozen the moment it is created. It is never edited; an
          accepted amendment mints a new version beside it. Choose carefully,
          because everything here becomes the standard your own amendments are
          judged against.
        </p>
      </div>

      <Card title="The policy" eyebrow="Version 1">
        <form onSubmit={submit} className="stack">
          <Field
            label="Treasury address"
            hint="Where a slashed bond is sent. Frozen into every case opened against this policy."
          >
            <input
              value={treasury}
              onChange={(event) => setTreasury(event.target.value)}
              placeholder="0x"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>

          <Field label="Title">
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>

          <Field
            label="Purpose"
            hint="State the purpose broadly. A description that says the treasury funds one narrow thing will cause otherwise reasonable amendments to fail the policy-purpose dimension."
          >
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>

          <Field
            label="Allowed spending categories"
            hint="Comma separated, lowercase, at most 24. This list is not a promise of completeness."
          >
            <input
              value={categories}
              onChange={(event) => setCategories(event.target.value)}
            />
          </Field>

          <div className="grid grid-2">
            <Field label="Maximum individual allocation" hint="Whole number, minor units.">
              <input
                value={maxAllocation}
                onChange={(event) => setMaxAllocation(event.target.value)}
                inputMode="numeric"
              />
            </Field>
            <Field label="Reference currency" hint="For example USD.">
              <input
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
              />
            </Field>
          </div>

          <Field
            label="Amendment bond"
            hint="In GEN. Real native GEN, locked by every proposer before their case can be judged."
            error={bondError}
          >
            <input value={bond} onChange={(event) => setBond(event.target.value)} />
          </Field>
          {!bondError && (
            <p className="small faint" style={{ marginTop: "-0.5rem" }}>
              {formatGen(bondWei)} &middot; <Mono>{bondWei.toString()}</Mono> wei
            </p>
          )}

          <Field
            label="Gating criteria"
            hint="Only the dimensions you select can block an amendment. All eight are always graded and displayed."
          >
            <div className="checkgrid">
              {DIMENSIONS.map((dimension) => (
                <label key={dimension} className="check">
                  <input
                    type="checkbox"
                    checked={criteria.includes(dimension)}
                    onChange={() => toggle(criteria, dimension, setCriteria)}
                  />
                  <span>{dimension.replace(/_/g, " ").toLowerCase()}</span>
                </label>
              ))}
            </div>
          </Field>

          <Field
            label="Required evidence categories"
            hint="Optional. Leave empty to accept any category."
          >
            <div className="checkgrid">
              {EVIDENCE_CATEGORIES.map((category) => (
                <label key={category} className="check">
                  <input
                    type="checkbox"
                    checked={requiredCategories.includes(category)}
                    onChange={() =>
                      toggle(requiredCategories, category, setRequiredCategories)
                    }
                  />
                  <span>{category.replace(/_/g, " ").toLowerCase()}</span>
                </label>
              ))}
            </div>
          </Field>

          <div className="grid grid-2">
            <Field label="Minimum evidence count" hint="1 to 8.">
              <input
                value={minEvidence}
                onChange={(event) => setMinEvidence(event.target.value)}
                inputMode="numeric"
              />
            </Field>
            <Field label="Minimum independent sources" hint="0 to 8, not above the count.">
              <input
                value={minIndependent}
                onChange={(event) => setMinIndependent(event.target.value)}
                inputMode="numeric"
              />
            </Field>
            <Field label="Evidence window (seconds)" hint="3600 to 2592000.">
              <input
                value={evidenceWindow}
                onChange={(event) => setEvidenceWindow(event.target.value)}
                inputMode="numeric"
              />
            </Field>
            <Field label="Challenge window (seconds)" hint="3600 to 2592000.">
              <input
                value={challengeWindow}
                onChange={(event) => setChallengeWindow(event.target.value)}
                inputMode="numeric"
              />
            </Field>
          </div>

          <WriteGate>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={
                flow.busy ||
                Boolean(bondError) ||
                !treasury.trim() ||
                !title.trim() ||
                !description.trim() ||
                criteria.length === 0
              }
            >
              {flow.busy ? "Publishing..." : "Publish policy"}
            </button>
          </WriteGate>
          <TransactionPanel state={flow.state} onRetry={flow.reset} />
        </form>
      </Card>

      <Card title="Before you publish" eyebrow="Frozen means frozen">
        <DataList
          rows={[
            ["Registered controller", dao.data ? <Mono key="c">{dao.data.controller}</Mono> : "unknown"],
            [
              "Editable later",
              "nothing: an accepted amendment mints a new version instead",
            ],
            [
              "Applies to existing cases",
              "no: each case is judged under the version it was opened against",
            ],
          ]}
        />
        <p style={{ marginTop: "1rem", marginBottom: 0 }}>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => navigate(`/daos/${encodeURIComponent(daoId)}`)}
          >
            Back to the DAO
          </button>
        </p>
      </Card>
    </div>
  );
}
