# Treasury Trial — GenLayer Submission

## Project title

**Treasury Trial** — *Every treasury decision has a case.*

## Short description

Evidence-gated governance amendments for DAO treasuries. Changing a frozen
treasury rule requires an amendment case: real web evidence, a real native GEN
bond, and a semantic judgment made on-chain by GenLayer under criteria the DAO
froze in advance.

## Full description

A DAO publishes a treasury policy — permitted spending categories, a maximum
individual allocation, evidence requirements, which of eight semantic criteria
may block an amendment, evidence and challenge windows, and a bond requirement.
The policy is frozen on publication and is never edited.

Changing exactly one field of it becomes a case. The proposer locks the bond in
native GEN, submits evidence citing public sources, and freezes the evidence
record. Adjudication fetches each source on-chain under a strict equality
principle, assembles a deterministic dossier, and grades the case across eight
dimensions, returning strict JSON. The contract validates that output against an
exact schema and closed vocabulary, then computes the decision itself from the
DAO's frozen criteria. Anyone but the proposer may challenge the proposed
verdict on one of nine grounds; resolution can replace the decision, and the
verdict history is append-only. Finalization mints a new immutable policy version
for an accepted case, or makes the bond slashable to the DAO treasury for a
substantively rejected one.

## Problem solved

DAO treasury parameters are changed on the strength of a forum post. There is no
standard for what counts as evidence, no test of whether cited sources are
independent, no check that a proposed increase is proportionate to the need
demonstrated, and no cost to proposing something unsupported. The vote measures
attention, not merit — and the rules being changed are the rules that protect the
treasury.

Treasury Trial makes the claim itself the object of review, and puts a price on
making one carelessly.

## Why GenLayer is essential

A deterministic contract can hold funds, count votes and compare numbers. It
cannot read a vendor quote and decide whether it supports the specific claim
being made; cannot decide whether two URLs are the same organisation; cannot
decide whether an increase is proportionate to a demonstrated need; cannot decide
whether a change is consistent with a policy's stated purpose; and cannot notice
that a cited page contains text aimed at the evaluator. An off-chain oracle only
relocates that judgment to a trusted party and returns an unreviewable number.

GenLayer provides non-deterministic judgment under consensus, from inside the
contract, in the same transaction that writes the result:

- `gl.nondet.web.render(url, mode="text")` inside `gl.eq_principle.strict_eq` —
  validators independently retrieve each source and must agree on its text before
  it influences anything. The proposer never supplies the judged text.
- `gl.eq_principle.prompt_non_comparative(fn, task=..., criteria=...)` — the
  input is a deterministic dossier built from frozen state; validators judge the
  integrity of the leader's evaluation rather than reproducing it verbatim.
- Verdict, per-dimension reasoning and the resulting policy version are written
  to chain state as part of the transaction.

## Reusable primitive

**Evidence-Gated Governance Amendments.**

> A treasury policy amendment should not become authoritative merely because a
> proposal passed socially; it should survive an evidence-backed semantic review
> under frozen rules.

The primitive generalises past treasuries to any parameter set that is supposed
to change only when the world has changed: risk parameters, listing criteria,
grant rubrics, emissions schedules, insurance terms. Its components are:

- real public-web evidence, fetched on-chain rather than supplied by the claimant
- policy context frozen at case-open, so the rules cannot move under a live case
- one change per case, structurally, so nothing can be bundled through
- semantic adjudication across named, published dimensions
- deterministic validation of the model's output, with the decision computed
  by the contract from the DAO's own criteria
- challenges with an append-only verdict history
- immutable version lineage
- real native GEN proposer bonds

## Architecture

```
DAO controller                     Proposer                     Anyone
     |                                |                            |
 register_dao                  open_amendment_case                 |
 create_policy  ---- frozen --->  lock_bond (payable, native GEN)  |
     |          policy snapshot   submit_evidence                  |
     |                            freeze_evidence                  |
     |                                |                            |
     |                        request_adjudication                 |
     |                    gl.nondet.web.render / strict_eq         |
     |                    prompt_non_comparative -> strict JSON    |
     |                    contract validates + computes decision   |
     |                                |                            |
     |                                |<-------- open_challenge ---|
     |                                |          resolve_challenge |
     |                            finalize_case                    |
     |            accepted -> new policy version (append-only)     |
     |            rejected -> bond slashable to frozen treasury    |
     |                            execute_payout                   |
     |                            confirm_payout (explicit)        |
```

- **Contract:** single Python Intelligent Contract, 2,070 lines, no proxies, no
  upgrade path, no admin surface beyond pause/unpause.
- **Frontend:** static React 18 + Vite + TypeScript client using genlayer-js
  1.1.8 directly against StudioNet. **No backend, no database, no indexer, no
  server API.**
- **State:** `TreeMap[str, str]` records with JSON payloads; every view returns a
  JSON string. No unbounded global enumeration by design — reads are scoped by
  DAO or by id.

## Contract ABI

29 public methods: **15 writes** (one payable) and **14 views**.

**Writes**

| Method | Notes |
|---|---|
| `register_dao` | claims an identifier; squatting protection only |
| `create_policy` | mints version 1; frozen on publication |
| `open_amendment_case` | exactly one field, one value |
| `lock_bond` | **the only payable method**; exact native GEN amount |
| `withdraw_case` | proposer only, before evidence freeze |
| `submit_evidence` | category, source URL, claim, independence declaration |
| `freeze_evidence` | separately committed; survives a failed adjudication |
| `request_adjudication` | on-chain fetch + graded evaluation under consensus |
| `open_challenge` | one of nine grounds; not by the proposer |
| `resolve_challenge` | may replace the proposed decision |
| `finalize_case` | mints a new policy version or fixes the slash |
| `execute_payout` | **takes only a case id**; recipient comes from frozen state |
| `confirm_payout` | explicit human acknowledgement, never automatic |
| `pause` / `unpause` | owner only; blocks new cases, cannot touch funds |

**Views**

`get_config`, `get_dao`, `get_dao_controller`, `get_current_policy`,
`get_policy`, `get_policy_history`, `get_case`, `list_cases`, `get_evidence`,
`get_case_evidence`, `get_challenge`, `get_case_challenges`, `get_bond_state`,
`get_verdict`

## Live contract

| | |
|---|---|
| Network | GenLayer StudioNet, chain id **61999** |
| Address | `0x7cD15c0d4F4741C2Ce3DD807246b6f13aA7f82A1` |
| Explorer | https://genlayer-explorer.vercel.app/contracts/0x7cD15c0d4F4741C2Ce3DD807246b6f13aA7f82A1 |
| Source SHA-256 | `95b6c42d53756d19701a67f9b62393ec02648ee4ac77c7c3ac57f1f9fd6a083e` |
| Source size | 90,868 bytes, 2,070 lines |
| Runtime pin | `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` (GenVM v0.2.16) |

## Repository and frontend

| | |
|---|---|
| GitHub | https://github.com/Chinny070/treasury-trial |
| Live frontend | https://treasury-trial.vercel.app |

## Live GEN verification

The bond is native GEN, transferred as transaction `value` on `lock_bond` and
paid out via `_Recipient(Address(a)).emit_transfer(value=u256(n))`. Verified on
StudioNet against the deployed contract:

| Behaviour | Evidence |
|---|---|
| Deposit and custody | `lock_bond` with exactly 1 GEN; wrong amounts revert |
| Refund to proposer | case `c_4`, bond `REFUNDED` to `0xaffE15eEc45b68835cc9E5B4Ab85dD5deaE8e70b` |
| Slash to third-party treasury | case `c_1`, bond `SLASHED` to `0x082a657bAA2ea66a3cfeD6dbeFeF18135d43a735` |
| Recipient not caller-controlled | `execute_payout` takes only a case id |
| Replay protection | a second payout attempt on a settled case reverts |
| Failed-transfer semantics | synchronous revert with atomic rollback; the settlement hook never fires on a failed send |

## Real tested outcomes

Read live from the deployed contract at the time of submission:

**REJECTED — `c_1`** (`example-dao`)
`maximum_individual_allocation` 50000 → 80000. Final decision `REJECTED`,
reason `GATE_FAILED:PROPORTIONAL_TO_NEED`. 2 evidence records, **3 challenges**,
4 verdict-history entries. Bond `SLASHED`, 1 GEN, disposition `SLASH`, to the
frozen treasury address.

**ACCEPTED — `c_4`** (`example-dao-5`)
`allowed_spending_categories.add` → `security`. Final decision `ACCEPTED`,
producing policy `p_6`. Bond `REFUNDED`, 1 GEN, disposition `REFUND`, to the
proposer.

**Rejections that were the protocol working, not failing:** `c_2` failed
`EVIDENCE_SUFFICIENT` because the policy already permitted the category being
"added"; `c_3` failed `POLICY_PURPOSE_CONSISTENT` because the policy's own
description said it funded grants and events *only*. Both remain readable.

## Immutable policy lineage example

`example-dao-5` currently reports 2 versions:

| Version | Policy id | Status | Created by |
|---|---|---|---|
| v2 | `p_6` | `ACTIVE` | case `c_4` |
| v1 | `p_5` | `SUPERSEDED` | founding policy |

The superseded version is not hidden, edited or removed. `c_4` was judged under
`p_5`'s frozen criteria; `p_6` records `p_5` as its predecessor and `c_4` as its
origin. The frontend reads this from `get_policy_history`; nothing is hardcoded.

## Undetermined-consensus finding

During live testing, a `request_adjudication` transaction settled with a receipt
reporting an accepted outcome and all eight dimensions passing — while
`get_verdict` still showed the case at `EVIDENCE_FROZEN` with an empty
`proposed_decision` and an empty history, and `finalize_case` then failed.
Consensus had not settled, so the attempted write was discarded. Re-running
`request_adjudication` succeeded; the evidence freeze survived because it is a
separate committed transaction.

The consequence is a hard rule in the frontend, enforced structurally rather
than by convention:

> A transaction hash is not success. A returned value is not success.

Every write goes through one function that waits for a settled receipt, inspects
the consensus result (`UNDETERMINED`, `CANCELED`, `VALIDATORS_TIMEOUT`,
`LEADER_TIMEOUT` all stop immediately), and then **re-reads authoritative
contract state**. Only a confirmed mutation produces `SUCCESS`; a settled receipt
whose state change is absent is reported as `STATE_MISMATCH`, a failure.
`Undetermined` is presented as a consensus condition with an explicit statement
that it is not a judgment about the merits of the amendment.

## Security and invariants

- **One change per case.** The contract accepts a single field and a single
  value, so a proposal cannot bundle a reasonable change with a self-serving one.
- **Frozen context.** Policy id, fingerprint, gating criteria, evidence
  requirements, both windows, bond amount and treasury address are snapshotted at
  case-open. A later policy version cannot change how a live case is judged.
- **Append-only policy lineage.** Versions are never edited or deleted.
- **Append-only verdict history.** Challenge outcomes supersede; they do not
  overwrite.
- **The contract decides.** The model's `outcome` cannot pass a failed gate;
  model uncertainty can never become an `INVALID` verdict.
- **Untrusted evidence.** Fetched page text is passed to the adjudicator inside
  untrusted-content markers, and manipulation signals are a graded dimension.
- **No caller-chosen recipients.** `execute_payout` takes only a case id.
- **Two-phase payout.** `confirm_payout` is a separate explicit transaction.
- **Minimal owner surface.** `pause` / `unpause` only. The owner cannot edit a
  policy, alter a verdict, or move funds.
- **The proposer cannot challenge their own case.**
- **No upgrade path, no proxy, no admin key over funds.**

## Known limitations

- Live web adjudication can produce **Undetermined** consensus. The write is
  discarded and can be retried; it is a consensus condition, not a verdict.
- **Strict equality on rich web content is conservative.** Pages carrying dated
  advisories or edit timestamps are harder to converge on. That is the cost of
  the proposer not controlling the judged text.
- **Screenshot-only evidence is not machine-verifiable in V1.** Only fetched text
  from a linked public page carries evidentiary weight.
- **`confirm_payout` remains an explicit human acknowledgement** after verifying
  outbound transfer finality.
- **DAO controller registration is protocol namespace ownership**, not legal or
  governance identity proof.
- Source independence is **assessed** from host normalisation and content, not
  proven by corporate lookup.

## Demo instructions

Read-only, no wallet required:

1. Open the live frontend.
2. Go to **DAOs** and look up `example-dao-5`. Open **Version history**: v2
   `ACTIVE` created by case `c_4`, v1 `SUPERSEDED`.
3. Open case `c_4` → **Adjudication** to read the eight graded dimensions, then
   **Bond** to see 1 GEN `REFUNDED` to the proposer.
4. Look up `example-dao` and open case `c_1`: a `REJECTED` case with three
   challenges, an append-only verdict history, and 1 GEN `SLASHED` to the frozen
   treasury address.
5. Open **Protocol** to see the live vocabulary and counters read from
   `get_config()`.

With a wallet on StudioNet (chain 61999), the full lifecycle is available from
**Register an identifier** onward. Every write shows its consensus result and
re-reads contract state before reporting anything.

## Screenshot checklist

1. Landing page with live counters from `get_config()`.
2. `example-dao-5` policy lineage: v2 `ACTIVE` beside v1 `SUPERSEDED`.
3. Case `c_1` overview: `REJECTED`, with the frozen criteria panel.
4. Case `c_1` challenges: three challenges and the append-only verdict history.
5. Case `c_1` bond: `SLASHED`, recipient = frozen treasury address.
6. Case `c_4` adjudication: all eight dimensions with reasoning, gating marked.
7. Case `c_4` bond: `REFUNDED` to the proposer.
8. Evidence card expanded, showing on-chain fetched text distinct from the
   submitter's own excerpt.
9. The transaction panel in its `CONSENSUS_UNDETERMINED` state.
10. Explorer view of the contract address.

## Demo video script (60–90 seconds)

**0:00–0:10 — The problem.**
"DAO treasury rules get changed on the strength of a forum post. A proposal says
costs went up, links a screenshot, and the vote measures attention, not merit.
The rules being changed are the rules protecting the treasury."

**0:10–0:20 — The shape.**
"Treasury Trial makes an amendment a case. This DAO's policy is frozen. Changing
one field requires evidence, a bond of real native GEN, and a judgment under the
criteria this DAO chose in advance." *(show policy page)*

**0:20–0:35 — Evidence and judgment.**
"Sources are fetched on-chain — validators must agree on the retrieved text
before it counts. Here is the fetched text next to what the submitter claimed.
GenLayer grades eight dimensions and returns strict JSON." *(open c_4
adjudication, scroll dimensions)*

**0:35–0:50 — The contract decides.**
"The model does not decide. The contract validates the JSON, then computes the
outcome from the DAO's frozen gating criteria. A model saying accept cannot pass
a failed gate. This case was accepted — and it minted a new policy version.
Version one is still here, superseded, not deleted." *(show lineage)*

**0:50–1:05 — The bond is real.**
"The bond is native GEN. Accepted: refunded. Rejected: slashed to the treasury
address frozen into the case. This one was rejected after three challenges, and
the GEN went to the DAO." *(show c_1 bond)*

**1:05–1:20 — Honest about consensus.**
"One more thing. On GenLayer a transaction can settle and still be Undetermined —
we hit a case where the receipt reported an accepted outcome while nothing had
been written. So nothing here reports success from a transaction result. Every
write re-reads contract state first, and Undetermined is shown as what it is: a
consensus condition, not a verdict."

**1:20–1:30 — Close.**
"Treasury Trial. Evidence-gated governance amendments. Every treasury decision
has a case."

## X announcement draft

> DAO treasury rules get changed on the strength of a forum post. No standard for
> evidence, no test of source independence, no cost to proposing something
> unsupported.
>
> Treasury Trial makes an amendment a case.
>
> One change. Real evidence, fetched on-chain. A real native GEN bond. Judged by
> @GenLayer under criteria the DAO froze in advance — accepted amendments mint a
> new immutable policy version, rejected ones forfeit the bond to the treasury.
>
> The model doesn't decide. It grades eight dimensions and returns strict JSON;
> the contract validates it and computes the outcome from the DAO's own gating
> criteria. A model saying "accept" cannot pass a failed gate.
>
> Live on StudioNet, both directions proven: 1 GEN slashed on a rejection, 1 GEN
> refunded on an acceptance, with the superseded policy version still readable.
>
> Evidence-gated governance amendments. Every treasury decision has a case.
