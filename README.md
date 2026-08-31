# Treasury Trial

**Every treasury decision has a case.**

A DAO writes down the rules its treasury runs on. Changing one of those rules is
not a forum post and a vote — it is a **case**: one specific amendment, real
evidence from the public web, a bond of real native GEN, and a judgment made by
GenLayer under the criteria the DAO itself froze in advance.

Accepted amendments mint a new immutable policy version. Rejected ones forfeit
the proposer's bond to the DAO treasury.

- **Live contract (StudioNet):** [`0x7cD15c0d4F4741C2Ce3DD807246b6f13aA7f82A1`](https://genlayer-explorer.vercel.app/contracts/0x7cD15c0d4F4741C2Ce3DD807246b6f13aA7f82A1)
- **Source SHA-256:** `95b6c42d53756d19701a67f9b62393ec02648ee4ac77c7c3ac57f1f9fd6a083e`
- **Submission document:** [`docs/GENLAYER_SUBMISSION.md`](docs/GENLAYER_SUBMISSION.md)

This is not a prediction market. There is no wagering, no YES/NO position, and
nothing to trade. GEN is an accountability bond.

---

## 1. What is Treasury Trial?

An Intelligent Contract and a frontend that turn a DAO treasury policy amendment
into an adjudicated case.

A DAO publishes a policy: permitted spending categories, a maximum individual
allocation, evidence requirements, which semantic criteria may block an
amendment, challenge and evidence windows, and a bond requirement. The policy is
frozen on publication and is never edited.

To change exactly one field of it, a proposer opens an amendment case, locks the
bond in native GEN, submits evidence, and freezes the evidence record. GenLayer
then fetches each cited source on-chain, grades the case across eight semantic
dimensions, and returns a structured verdict. The contract validates that
verdict and computes the decision from the DAO's own frozen criteria. Anyone but
the proposer may challenge the result. Finalization mints a new policy version
or slashes the bond.

## 2. What trust problem does it solve?

DAO treasury parameters get changed on the strength of a forum post.

A proposal says infrastructure costs went up 60%, so the per-grant cap should
rise. Maybe it links a screenshot. Maybe it cites two "independent" sources that
are the same vendor under two domains. There is no standard for what counts as
evidence, no test of independence, no check that the increase is proportionate
to the need actually demonstrated, and no cost to proposing something
unsupported. The vote measures attention and social capital, not merit — and the
rules being changed are exactly the rules that protect the treasury.

Treasury Trial makes the claim itself the thing under review, and puts a price
on making one carelessly.

## 3. Why can't a normal deterministic smart contract solve it?

A Solidity contract can hold funds, count votes, enforce a timelock, and compare
numbers. It cannot do any of the following, which is the entire substance of the
problem:

- Read a vendor quote or an incident advisory and decide whether it **supports
  the specific claim being made**.
- Decide whether two cited sources are **genuinely independent** of each other
  and of the proposer, when they are different URLs published by the same
  organisation.
- Decide whether a proposed increase is **proportionate to the need actually
  demonstrated** by the evidence, rather than merely larger than the old number.
- Decide whether a change is **consistent with the stated purpose** of the policy
  it is amending.
- Notice that a page cited as evidence contains **text aimed at the evaluator**
  rather than at a human reader.

Every one of those is a judgment about meaning. An oracle does not fix this: it
moves the same judgment off-chain to a party you now have to trust, and returns
a number with no reviewable reasoning.

## 4. Why is GenLayer materially necessary?

GenLayer supplies exactly the missing piece: **non-deterministic judgment made
under consensus, from inside the contract, as part of the transaction.**

- Evidence is fetched **on-chain** with `gl.nondet.web.render`, wrapped in
  `gl.eq_principle.strict_eq`. Validators must independently retrieve the source
  and agree on its text before it is allowed to influence anything. The proposer
  never supplies the text that gets judged.
- Adjudication runs through `gl.eq_principle.prompt_non_comparative`, where the
  input is a deterministic dossier built from frozen state, and validators judge
  the **integrity** of the leader's evaluation rather than needing to reproduce
  it token for token.
- The verdict, its per-dimension reasoning, and the resulting policy version are
  **written to chain state** in the same transaction. The judgment is a protocol
  record, not an API response someone screenshotted.

Without GenLayer this protocol is a form that collects links.

## 5. What real-world evidence is evaluated?

Public web sources cited by URL: vendor pricing pages, security advisories,
infrastructure documentation, audit reports, regulatory filings, governance
records of comparable DAOs, and historical treasury spend.

Each evidence record carries a category, the claim it is meant to establish, a
declared independence status, and an optional affiliation note. At adjudication
the contract fetches each URL on-chain; the retrieved text is inserted into the
dossier between untrusted-content markers, and the adjudicator is instructed to
treat everything inside them as data rather than as instructions. A source that
cannot be fetched is recorded as unverified and carries no evidentiary weight
toward the independence requirement.

## 6. How does the deterministic validator constrain semantic judgment?

This is the part that matters most, and it is why the model cannot decide
anything on its own.

The adjudicator must return strict JSON: an outcome, a numeric-support level, a
short reason, decisive and unverified evidence ids, manipulation signals, and a
PASS/FAIL/UNCLEAR grade with reasoning for each of eight dimensions. The contract
then:

1. **Validates the shape and the vocabulary.** Unknown keys, missing dimensions,
   or values outside the closed vocabulary are rejected outright.
2. **Computes the decision itself.** An amendment is accepted only if every
   gating dimension *the DAO froze into its own policy* passed. The model's own
   `outcome` field is stored and displayed, but it cannot rescue a failed gate.
3. **Keeps uncertainty out of the verdict vocabulary.** `INVALID` means the case
   was malformed — it never means the model was unsure. An unsure model produces
   `UNCLEAR` dimensions, which fail a gate rather than voiding the case.

Consensus decides whether a verdict is admissible. The contract decides what it
means.

The eight dimensions: `MATERIAL_CHANGE_CONFIRMED`, `POLICY_PURPOSE_CONSISTENT`,
`PROPORTIONAL_TO_NEED`, `EVIDENCE_SUFFICIENT`, `SOURCE_INDEPENDENCE`,
`REASONABLE_ALTERNATIVES_CONSIDERED`, `CONFLICT_OF_INTEREST_CLEAR`,
`MANIPULATION_RISK_ACCEPTABLE`. All eight are always graded and displayed; a DAO
chooses which subset can actually block an amendment.

## 7. How do challenges work?

Once a verdict is proposed, the case enters its challenge window. Anyone except
the proposer may open a challenge on one of nine specific grounds — fabricated
evidence, sources not independent, the same source behind multiple URLs, the
change not being material, disproportion, multiple changes smuggled into one,
conflict of interest, prompt injection in the evidence, or policy-purpose
violation — with a statement and optional citations to evidence already on the
case.

Resolving a challenge re-runs the relevant part of the evaluation and can
replace the proposed decision. Nothing is overwritten: the verdict history is
append-only, and superseded entries stay visible with the reason they were
superseded. Finalization is only possible after the window has elapsed.

## 8. How do real native GEN bonds work?

The bond is **native GEN**, sent as transaction `value` to the single payable
method `lock_bond`. It is not a token balance, an accounting entry, or a
simulated escrow.

- The contract requires the exact amount the policy froze. Any other value
  reverts, so there is no partial bond and no overpayment to reclaim.
- At finalization the contract fixes the disposition and freezes the recipient.
  **Accepted**, **invalid** and **withdrawn** cases are refundable to the
  proposer; only a substantive **rejection** is slashable to the DAO treasury
  address that was frozen into the case when it opened.
- `execute_payout(case_id)` takes **only a case id**. The recipient and amount
  come from frozen state, so no caller — including the contract owner — can
  redirect where the GEN goes. It emits the transfer via
  `_Recipient(Address(a)).emit_transfer(value=u256(n))` and moves the bond to
  *payout pending*.
- `confirm_payout` is a separate, explicit transaction. It is never called
  automatically, because a returned value is not evidence that GEN arrived.

Both directions have been executed live on StudioNet (§10).

## 9. How is immutable policy lineage preserved?

Policies are append-only. An accepted amendment does not edit anything: it mints
a new version that records its predecessor, the case that produced it, its
creator, and a content fingerprint. The previous version is marked `SUPERSEDED`
and stays fully readable forever.

Each case snapshots the policy id, its fingerprint, the gating criteria, the
evidence requirements, both windows, the bond amount and the treasury address at
the moment it opens. A later policy version therefore cannot change how an
in-flight case is judged, and the record of what the treasury was permitted to
do at any point in its history survives intact.

## 10. What was proven live?

All of the following are real transactions against the deployed contract on
StudioNet, readable right now through the frontend or any genlayer-js client.

| Proof | Where |
|---|---|
| Native GEN deposit, custody, and refund to the proposer | case `c_4`, bond `REFUNDED` |
| Native GEN slashed to the frozen third-party treasury | case `c_1`, bond `SLASHED` to `0x082a657bAA2ea66a3cfeD6dbeFeF18135d43a735` |
| A full REJECTED lifecycle, including three challenges | case `c_1`, verdict history of 4 entries |
| A full ACCEPTED lifecycle minting a new policy version | case `c_4` → policy `p_6` |
| Immutable lineage with a superseded version still visible | `example-dao-5`: `p_5` v1 `SUPERSEDED`, `p_6` v2 `ACTIVE` created by `c_4` |
| On-chain web evidence retrieval under strict equality | 8 evidence records across 4 cases |
| Replay protection on payout | second payout attempt reverts |

Two findings from that live work shaped the frontend and are documented rather
than smoothed over:

- **`gl.get_webpage` does not work on this runtime.** Every fetch returned
  `UNAVAILABLE`. The working call is `gl.nondet.web.render(url, mode="text")`
  under `strict_eq`. A contract *calling* an API is not evidence that it
  succeeds.
- **An `Undetermined` transaction discards state.** One `request_adjudication`
  returned a settled receipt reporting an accepted outcome, while `get_verdict`
  still showed the case frozen with an empty history and `finalize_case`
  subsequently failed. This is why every write in the frontend re-reads
  authoritative contract state before reporting success.

## 11. Known limitations

Stated plainly, because a reviewer will find them anyway.

- **Live web adjudication can end `Undetermined`.** Validators sometimes fail to
  converge, most often when a cited page carries a dated advisory or an edit
  timestamp that changes between fetches. The attempted write is discarded and
  the operation can simply be retried; the evidence freeze survives because it is
  a separate committed transaction. It is a consensus condition, not a verdict.
- **Strict equality on rich web content is conservative.** It is the reason the
  evidence a proposer cites cannot be quietly substituted, and it is also the
  reason volatile pages are harder to adjudicate. That trade is deliberate.
- **Screenshot-only evidence is not machine-verifiable in V1.** Images are never
  machine-verified; only the fetched text of a linked public page carries
  evidentiary weight.
- **`confirm_payout` remains an explicit human acknowledgement** after verifying
  outbound transfer finality. It is not automated, and it is not meant to be.
- **DAO controller registration is protocol namespace ownership**, not proof of
  legal or governance identity. It prevents identifier squatting and grants no
  power over policies, cases, verdicts or funds.
- **Source independence is assessed**, from host normalisation and content, not
  proven. It is not a corporate-structure lookup.

## 12. How do I run the frontend?

```bash
cd frontend
npm install
npm run dev
```

That is the whole setup. There is no backend, no database, no indexer, and no
API key: the app is a static client that reads the deployed contract directly
and signs writes with the visitor's own wallet. It runs with no `.env` at all,
against the canonical StudioNet deployment.

Reading requires no wallet. Writing requires an injected EIP-1193 wallet on
**StudioNet, chain id 61999**. See [`frontend/README.md`](frontend/README.md)
for the transaction lifecycle, the per-write revalidation table, and deployment.

---

## Layout

```
contracts/treasury_trial.py          production Intelligent Contract (29 methods)
contracts/capability_test/           non-production native GEN probes (Stage 1)
contracts/capability_test/bisect/    schema-load bisect artifacts, kept as evidence
docs/                                architecture, audit, live checklist, submission
frontend/                            Treasury Chamber: React + Vite + genlayer-js
tests/                               325 pytest tests, direct mode, nondeterminism mocked
```

## Tests

```bash
python -m pytest tests/ -q      # 325 contract tests
cd frontend && npm test          # 80 frontend tests
```

The Python suite mocks every web and model call and never touches live GEN. Real
value movement is covered by the manual
[StudioNet checklist](docs/STUDIONET_LIVE_BOND_CHECKLIST.md).

## Runtime

Pinned to `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`
(GenVM v0.2.16) on StudioNet. Contract source must remain **pure ASCII** — a
single non-ASCII byte, comments included, makes Studio schema extraction fail,
as does an over-long leading comment block. Both are enforced by
`tests/test_source_shape.py`.
