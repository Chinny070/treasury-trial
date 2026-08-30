# Treasury Trial - Stage 2: Protocol Core

> Implementation reference for `contracts/treasury_trial.py`.
> Binding architecture: [`STAGE_1_ARCHITECTURE_AND_GEN_AUDIT.md`](STAGE_1_ARCHITECTURE_AND_GEN_AUDIT.md).
>
> **Status:** contract implemented and tested. **Not deployed.** No frontend. Stage 3 not started.

---

## 1. What this contract is

An Intelligent Contract implementing evidence-backed policy amendment for DAO treasuries:

```
DAO registration
  -> versioned policy
    -> amendment case (exactly one field)
      -> proposer GEN bond (real native GEN)
        -> evidence
          -> evidence freeze
            -> GenLayer semantic adjudication
              -> proposed verdict
                -> challenge (max 3, distinct grounds)
                  -> final resolution
                    -> bond disposition
                      -> separate payout execution
```

The organising principle from Stage 1 holds throughout: **deterministic accounting wraps nondeterministic judgment.** Exactly two methods invoke the model (`request_adjudication`, `resolve_challenge`); everything that touches money or policy state is deterministic and independently checkable.

---

## 2. Runtime and source constraints

| Constraint | Why | Enforced by |
|---|---|---|
| Runner pinned to `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` (GenVM v0.2.16) | The only runner verified against this user's deployed contracts. No blocker found in Stage 2. | `tests/test_source_shape.py::test_runner_pin_header_present` |
| **Pure ASCII source**, comments included | A single non-ASCII byte makes Studio's `gen_getContractSchemaForCode` fail with `VM_ERROR: invalid_contract` | `test_contract_source_is_pure_ascii`, `test_no_typographic_characters_slip_in`, `test_contract_source_has_no_crlf_or_bom` |
| `def __init__(self):` with no return annotation | `-> None` breaks Studio schema extraction | `test_init_has_no_return_annotation` |
| **One** `emit_transfer` call site, behind one parameterized payout method | A contract with separate refund and slash payout methods failed to load its schema; the same logic behind one method loaded and worked live | `test_exactly_one_emit_transfer_call_site`, `test_no_separate_refund_and_slash_methods` |
| **`__init__` is the only dunder** | `__on_errored_message__` broke schema extraction. Every contract of the user's that deploys - Foresign, Continuum, SeedWager - has `__init__` alone. | `test_init_is_the_only_dunder_method` |
| **Only `str` or no annotation** on method params and returns | Foresign, which deploys, uses nothing else. Treasury Trial's one `bool` parameter and one `-> int` return were removed while making it loadable. | `test_only_str_annotations_are_used` |
| **No docstrings on `@gl.public.*` methods** | Across Foresign, Continuum, SeedWager and Seedling there are 138 public methods and zero docstrings on any of them. Treasury Trial had 14 (largest 1339 chars) and Studio could not extract its schema. Docstrings on module functions and private methods are fine and those contracts use them. Content was moved to `#` comments above each decorator, not deleted. | `test_no_docstrings_on_public_methods` |
| **Leading comment block <= 4 lines** | THE cause of the Stage 2 schema-load failure. Proven by bisect: an identical contract body failed with a 31-line leading block (1688 bytes) and loaded with a 2-line one. GenVM v0.2.16 scans leading comments for the `Depends` directive. Foresign has 2 lines, Continuum 3. All commentary goes BELOW the imports, where it is unrestricted. | `test_leading_comment_block_is_short` |
| Outbound transfer is a **separate emitted transaction** | Observed on StudioNet (Stage 1 section 16). Settlement never assumes value moved in the calling transaction. | payout design, section 7 |

The CRLF guard is not theoretical: it caught a real regression during Stage 2 when a scripted edit rewrote the contract with Windows line endings.

---

## 3. DAO authorization

`register_dao(dao_id)` - first registrant claims an unused id, permanently.

- `dao_id`: 1-64 chars, `[a-z0-9._-]`, must contain at least one alphanumeric.
- The claimant becomes the **protocol controller**. This asserts nothing about legal or governance ownership of any real organization, and the contract says so in its own docstring.
- Controller power is **squatting protection only**. The controller may call `create_policy` once, to mint version 1. They cannot edit any policy, mint v2+, decide a case, alter a verdict, or move any GEN.
- No transfer, no de-registration in V1 - both are admin-swap attack surface with no V1 use case.
- Proposing and challenging are **permissionless**.

Residual risk: `dao_id` string squatting. Mitigated off-chain (a DAO publishes its canonical id). Accepted for V1, recorded in Stage 1 A.2.

---

## 4. Versioned policies

A policy record is immutable once written. `create_policy` can only ever mint **version 1**; every later version is minted by the contract itself inside `finalize_case` when a case is ACCEPTED.

```
p_v1 (ACTIVE) --accepted case--> p_v2 (ACTIVE), p_v1 becomes SUPERSEDED
current_policy[dao_id] moves to p_v2
p_v1's substantive fields are never touched
```

- `current_policy: TreeMap[dao_id, policy_id]` is the only mutable pointer.
- History is an append-only chain walked via `previous_policy_id`, exposed paginated through `get_policy_history`.
- `policy_hash` is a fingerprint over the substantive fields (section 9).
- Cap: 64 versions per DAO.

**No retroactive rules.** A case snapshots its policy at open time and is judged only under that snapshot, even if a newer version lands first. Enforced additionally by three independent checks before a version is minted: the current-policy pointer, the fingerprint, and the literal `old_value`.

---

## 5. The 8 amendable fields

Exactly one change per case. There is no batch entry point, so a multi-field amendment cannot be expressed.

| `target_field` | `proposed_value` | Validation |
|---|---|---|
| `maximum_individual_allocation` | integer string | `>= 0`, differs from current |
| `amendment_bond_requirement` | integer string (GEN wei) | `> 0`, differs |
| `challenge_window_seconds` | integer string | `3600..2592000`, differs |
| `evidence_window_seconds` | integer string | `3600..2592000`, differs |
| `minimum_evidence_count` | integer string | `1..8`, differs, must not drop below `minimum_independent_sources` |
| `minimum_independent_sources` | integer string | `0..8`, differs, must not exceed `minimum_evidence_count` |
| `allowed_spending_categories.add` | one category | normalized, absent, list stays `<= 24` |
| `allowed_spending_categories.remove` | one category | present, list stays `>= 1` |

**Not amendable in V1:** `dao_id`, `title`, `description`, `treasury_address`, `reference_currency`, `amendment_criteria`, `required_evidence_categories`. `treasury_address` especially - an amendment that could redirect the slash destination is the highest-value attack in the system.

---

## 6. Case lifecycle

```
DRAFT --lock_bond--> EVIDENCE_OPEN --freeze_evidence--> EVIDENCE_FROZEN
  --request_adjudication--> VERDICT_PROPOSED
    [--open_challenge--> CHALLENGE_WINDOW --resolve_challenge--> ...]
      --finalize_case--> DECIDED
```

Early exit: `WITHDRAWN`, proposer only, DRAFT only, before any bond is locked. A bonded case cannot be withdrawn - the proposer is committed.

At most **one active case per DAO**. The slot frees on finalization or withdrawal.

**Why `freeze_evidence` is its own transaction.** Freezing inside `request_adjudication` looked simpler, but a malformed model response rolls that transaction back - and would roll the freeze back with it, reopening submissions. Committing the freeze first makes it durable: a failed adjudication can never unfreeze or mutate evidence. This was found by a test, not by inspection.

---

## 7. Bond lifecycle and payout

```
NONE --lock_bond (payable)--> LOCKED
  --finalize_case--> REFUNDABLE | SLASHABLE
    --execute_payout--> PAYOUT_PENDING     (emitted, not proven delivered)
      --confirm_payout--> REFUNDED | SLASHED
```

### 7.1 Locking

`lock_bond(case_id)` is `@gl.public.write.payable` and **takes no amount argument**. The amount comes from `gl.message.value` - runtime state - and must equal the bond frozen into the case **exactly**. A declared/received mismatch is structurally impossible because nothing is declared. Over- and underpayment are both rejected; there is no change-making.

### 7.2 Disposition

Decided deterministically in `finalize_case`, with no model involvement:

| Final decision | Bond | Recipient |
|---|---|---|
| `ACCEPTED` | `REFUNDABLE` | proposer |
| `INVALID` | `REFUNDABLE` | proposer |
| `REJECTED` | `SLASHABLE` | frozen `treasury_address` |

`INVALID` refunds - the locked Stage 1 decision. Only a substantive rejection forfeits the bond.

### 7.3 One parameterized payout

`execute_payout(case_id)` takes **only a case id**. The recipient is read from the settlement record written at finalization and cross-checked against the frozen case; no caller, including the contract owner, can redirect it. The amount is the exact locked bond and is asserted not to exceed it.

Status flips to `PAYOUT_PENDING` **before** the transfer is emitted, so a second call cannot emit a second transfer.

### 7.4 Failed outbound transfer

This was Stage 1's open item **G**, and it is **not solved**. What follows is the safest design available under a hard constraint.

**The constraint.** An earlier revision reopened a failed payout from an `__on_errored_message__` hook. Studio could not extract the contract schema with that dunder present. Diffing against the user's contracts that do deploy - Foresign, Continuum, SeedWager - every one of them carries `__init__` as its **only** dunder. The hook was removed to make the contract deployable.

**The consequence.** The runtime gives the contract no positive success signal for an emitted transfer, and the failure callback is unusable. `execute_payout` therefore cannot know whether the GEN arrived.

**The design:**

- **No automatic retry, and no blind retry.** `execute_payout` refuses while a payout is in flight. Without a failure signal the contract cannot distinguish "not delivered" from "delivered", and a caller-driven retry would risk paying twice.
- **A stalled payout preserves everything.** `PAYOUT_PENDING` keeps the exact amount, recipient, disposition and emission time. Nothing is lost; the entitlement simply is not yet booked.
- **Confirmation is separate, permissionless, and withholdable.** `confirm_payout(case_id)` books finality after `PAYOUT_CONFIRM_DELAY`. It moves nothing and emits nothing, so it can never cause a second transfer - and it can simply be *withheld* when the outbound transfer was not observed to succeed.
- **A completed payout is terminal.** No method reopens `REFUNDED`/`SLASHED`.

> **Known limitation, stated plainly.** If an outbound transfer fails and `confirm_payout` is called anyway, the case is booked complete while the GEN is still held by the contract. There is no in-contract recovery path. Detection is off-chain: compare the contract's on-chain balance against the sum of settlements not yet confirmed. **Do not confirm a payout whose transfer you have not seen succeed on the explorer.**
>
> Resolving this properly needs either a Studio-loadable failure callback or a verified balance accessor. Neither exists today. This is the largest outstanding risk in the protocol.
>
> What is **not** at risk: double payment. The status guard blocks it regardless.

---

## 8. Evidence

Bounded records; **no full page bodies are ever persisted**.

| Field | Bound |
|---|---|
| `category` | 11-value frozen enum |
| `title` | 160 |
| `source_url` | 400, `http(s)` only, no spaces |
| `url_normalised` | duplicate key - lowercased host+path, query/fragment/`www.`/trailing slash stripped |
| `excerpt` | 1200 (submitter-supplied, treated as unverified) |
| `claim` | 400 |
| `independence_declared` | `INDEPENDENT` / `AFFILIATED` / `SELF_PUBLISHED` / `UNKNOWN`; a note is mandatory unless INDEPENDENT |
| `fetch_status` | `NOT_ATTEMPTED` / `FETCHED` / `UNAVAILABLE` |
| `fetched_excerpt` | 3000-char slice from `gl.get_webpage` |

Caps: 12 evidence per case, of which at most 3 may be text-only.

**Deduplication vs independence.** `url_normalised` catches the same source dressed up as `http`/`https`, `www.`, trailing slash, tracking query, or fragment. It is a duplicate key and nothing more. The contract does **not** claim that different hostnames mean different organizations - same-host items are surfaced to the adjudicator as an explicit non-independent cluster, and the prompt states that host diversity is a floor, not proof. Genuine independence is a semantic question judged under `SOURCE_INDEPENDENCE`.

**Screenshots** remain honestly non-machine-verifiable. Every record carries `image_not_machine_verified: true`, and the prompt instructs the model to rely on fetched text of a linked original and treat an unfetchable claim as unverified. No image bytes are ever passed to the model.

**Unavailable sources** downgrade that item rather than aborting adjudication. If every primary item is unfetchable and the policy requires independent sources, the contract - not the model - declares the case structurally `INVALID`.

---

## 9. Fingerprints

`policy_hash` and `evidence_fingerprint` use a pure-Python 64-bit FNV-1a over a canonical (sorted-key, separator-normalized) JSON serialization.

**Why not sha256:** no contract in this codebase has ever imported `hashlib`, so its availability under the pinned runner is unverified, and a dependency-free fingerprint cannot fail at load time. `hashlib.sha256` does work in the local direct runner, but that runner is CPython, not GenVM - not evidence.

These are integrity anchors against accidental drift and stale snapshots, **not cryptographic commitments**, and nothing security-critical rests on them: a case also stores the explicit `old_value` it was opened against, and staleness is rejected on that exact value. Upgrading to sha256 is a one-line change once `hashlib` is confirmed in Studio.

---

## 10. Semantic adjudication

Verified APIs only: `gl.get_webpage(url, mode="text")`, `gl.nondet.exec_prompt`, `gl.eq_principle.prompt_comparative`.

- Only URLs **already frozen into the case** are fetched. Nothing the model returns can trigger a fetch, and the prompt forbids inventing or following URLs.
- Fetched text is enclosed in `<<<UNTRUSTED_WEB_CONTENT>>>` markers, and the model is told it is data, never instructions - and that an instruction found inside evidence is itself a manipulation signal that fails `MANIPULATION_RISK_ACCEPTABLE`.
- Fetched text outranks submitter excerpts; a mismatch makes the item unreliable.
- **Bond size and every economic figure about the stake are excluded from the prompt entirely.** The only numbers shown are the policy values under judgment. Asserted directly against the generated prompt text in `test_bond_size_is_absent_from_the_adjudication_prompt`.

### Cost reasoning

- `numeric_delta` is computed **on-chain** from the frozen old and proposed values and passed as a fact about the *proposal*, never as a claim about the world.
- The prompt requires figures to appear verbatim in the evidence, forbids inventing, rounding or extrapolating, and requires qualitative reasoning where the evidence is qualitative.
- The model must report `numeric_support` as `NONE` / `PARTIAL` / `STRONG`, so thin numeric grounding is visible rather than hidden.
- Where a delta would be meaningless (category changes, zero base), the contract emits `""` rather than manufacturing a figure.

---

## 11. The deterministic validator

Model output is never authoritative. `_validate_model_output` is a pure function that rejects, and thereby rolls the whole transaction back atomically:

- non-JSON, fenced output, non-object, or over 4000 chars;
- any missing key, any extra key (top level and inside every dimension);
- wrong vocabulary for `outcome`, `numeric_support`, or any dimension `result`;
- anything other than exactly the 8 canonical dimensions;
- overlong reasons, signals or `short_reason`; empty `short_reason`;
- evidence references that are unknown to the case, or duplicated;
- `invalid_reason` outside the canonical list when INVALID, or non-empty when not.

Then `_decide` - also pure, and asserted by test to touch no storage - computes the decision:

```
if a structural defect was established ON-CHAIN:      INVALID (contract's reason)
elif model said INVALID:                              INVALID (canonical reason only)
elif any dimension the POLICY gated is not PASS:      REJECTED
elif model said ACCEPT:                               ACCEPTED
else:                                                 REJECTED
```

**INVALID is narrow by construction.** The five canonical reasons are all structural. Model uncertainty cannot reach INVALID at all, because uncertainty is expressed as an `UNCLEAR` *dimension result*, and any non-`PASS` gated dimension routes to REJECTED. Tested across all 8 dimensions.

Only the dimensions the DAO froze into its policy act as gates - a DAO that did not adopt `REASONABLE_ALTERNATIVES_CONSIDERED` is not bound by it.

---

## 12. Challenges

Proposer bond only in V1: `open_challenge` is not payable and challengers post nothing.

Bounded structurally instead:
- **max 3 per case**, ever;
- each on a **distinct canonical ground** (9 grounds);
- **one open at a time** - the previous must be resolved first;
- the proposer may not challenge their own case;
- only **already-frozen** evidence may be cited, with no duplicates;
- the challenge window must still be open.

Together these are the anti-model-shopping control: nobody can re-roll the adjudicator until they like the answer.

Outcomes preserve the Stage 1 vocabulary, derived deterministically from whether re-adjudication changed the decision:

| Result | Meaning |
|---|---|
| `REJECTED` | decision unchanged; the standing verdict remains in force |
| `UPHELD` | decision changed away from ACCEPTED |
| `PARTIAL` | decision changed to ACCEPTED |

`UPHELD` and `PARTIAL` write a **replacement** verdict. The original is never overwritten: `verdict_history` is append-only, each entry tagged with its source, and each challenge keeps its own `result_json` and `replacement_decision`. Evidence is never unfrozen.

---

## 13. Finalization

`finalize_case(case_id)` is deterministic, permissionless, and runs no model. It requires no open challenge, and either a closed challenge window or all 3 challenges exhausted.

In one step it freezes: the effective verdict, the policy version (minting the successor on ACCEPTED), the case disposition, and the bond disposition. There is no admin rewrite afterwards - asserted by test, including from the owner account.

---

## 14. Pause matrix

Principle: **pause stops new exposure; it never strands owed GEN.**

| Action | Paused? |
|---|---|
| `register_dao`, `create_policy` | blocked |
| `open_amendment_case`, `withdraw_case` | blocked |
| `lock_bond` | blocked |
| `submit_evidence`, `freeze_evidence` | blocked |
| `request_adjudication` | blocked |
| `open_challenge`, `resolve_challenge` | blocked |
| `finalize_case` | blocked |
| **`execute_payout`** | **allowed** |
| **`confirm_payout`** | **allowed** |
| all views | allowed |

A bond that has reached `REFUNDABLE`/`SLASHABLE` is owed, and stays claimable throughout a pause. Tested for both the refund and slash paths.

---

## 15. GEN safety invariants

| Invariant | How |
|---|---|
| No owner drain | Owner surface is `pause`/`unpause` only, asserted by AST inspection |
| No arbitrary withdrawal | No withdraw/sweep/drain method exists anywhere in the ABI |
| No creator-controlled recipient | `execute_payout` takes only a case id; recipient comes from frozen case state |
| No double payout | Status flips before emit; `PAYOUT_PENDING` blocks re-entry; completed statuses are terminal |
| No payout before disposition | `execute_payout` requires `REFUNDABLE`/`SLASHABLE` |
| No payout above the bond | Amount checked against the frozen `bond_amount` |
| Bond size never influences the verdict | Excluded from the prompt; asserted against the generated text |
| INVALID refunds | Deterministic mapping in `finalize_case` |
| Transfer state kept separate | `settlements` is a distinct record from the case's semantic state |
| No cross-case payout | Every payout reads its own case's settlement |

---

## 16. Storage bounds

| Collection | Cap |
|---|---|
| policy versions per DAO | 64 |
| cases per DAO | 256 |
| active cases per DAO | 1 |
| evidence per case | 12 (text-only: 3) |
| challenges per case | 3 |
| spending categories | 24, each 60 chars |
| amendment criteria | 8 |
| required evidence categories | 8 |
| stored verdict JSON | 4000 |
| fetched text per source | 3000 |
| pagination | default 20, max 50 |

No `TreeMap` is ever fully iterated in a production view. There is no `get_all_*`. Model output is stored canonicalized and size-capped; no full webpage body is persisted anywhere.

---

## 17. Native GEN proof references

From Stage 1 section 16, verified live on StudioNet by the user, Claude broadcast nothing:

| What | Transaction |
|---|---|
| Refund probe contract | `0x726c603E91bD01c08d4b29158407D63068ce891c` |
| Deposit, 1 GEN | `0x071c7c8b...2261a651` |
| Refund, contract -> depositor EOA, 1 GEN | `0xb565de65...4c34334` |
| Double-claim blocked (Rollback, Value 0) | second `claim_refund`, nonce 620 |
| Slash probe contract | `0xd3F6B164d1af5fb16e772A7700b53946Be4FC900` |
| Payout, contract -> third-party treasury, 1 GEN | `0x36420a2c...2e603588` |

---

## 18. Known limitations

1. **Failed outbound transfers have no in-contract recovery** (Stage 1 item G, still open). `__on_errored_message__` cannot be used - it breaks Studio schema extraction - so a failed transfer leaves the case at `PAYOUT_PENDING` with the GEN held by the contract, and confirming it anyway books it complete incorrectly. Detection is off-chain. Highest-priority item before real value. Double payment is *not* at risk. See section 7.4.
2. **`policy_hash` is a 64-bit FNV-1a fingerprint**, not a cryptographic commitment (section 9).
3. **Local test runner diverges from Studio.** gltest's direct runner extracts py-lib-genlayer-std **v0.3.0-rc7**, which exposes `gl.nondet.web` and has **no `gl.get_webpage`**; the pinned Studio runner has `gl.get_webpage` (used by the user's deployed Contradiction Protocol). Production code keeps the Studio-verified API and the harness shims it. **The contract's schema has not been loaded in Studio yet** - that is a Stage 3 first step.
4. **Direct-mode harness cannot move real value.** `emit_transfer` surfaces as an `EthSend` request with no balance effect, so tests assert emitted recipient/amount, not balances. Real movement was proven live in Stage 1.
5. **gltest's LLM mock cannot round-trip floats** - a float in a mocked response silently yields `None`. Documented inline where it matters.
6. **`dao_id` squatting** remains an accepted V1 residual risk.
7. **No challenger bonds** in V1 by decision; spam is bounded structurally, not economically.
8. **No policy version cap recovery** - a DAO reaching 64 versions cannot amend further in V1.
9. **`treasury_address` is not amendable** in V1. A DAO that loses control of its treasury address cannot migrate without a new `dao_id`.
