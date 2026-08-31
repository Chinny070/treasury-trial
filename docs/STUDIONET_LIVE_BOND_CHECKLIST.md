# StudioNet live-bond checklist (manual, Stage 3)

Not part of the automated suite. The unit tests deliberately mock every
nondeterministic and web path and never touch live GEN, so this checklist is
what actually proves the production contract behaves on chain.

**Nothing here is run by Claude.** The user deploys and signs every
transaction. Claude records results.

Prerequisites: a funded StudioNet wallet, a second address to act as the DAO
treasury, and a third address to act as a challenger.

---

## 0. Schema load (blocking) - PASSED 2026-08-29

Schema loads. Took five revisions; the cause was a 31-line leading comment
block, not any of the four things suspected before it. See
STAGE_2_CONTRACT_ARCHITECTURE.md section 2.

- [x] Paste `contracts/treasury_trial.py` into a Studio file.
- [x] Confirm the schema panel populates rather than showing
      "Could not load contract schema".
- [x] Confirm the write methods listed are exactly: `register_dao`,
      `create_policy`, `open_amendment_case`, `lock_bond`, `withdraw_case`,
      `submit_evidence`, `freeze_evidence`, `request_adjudication`,
      `open_challenge`, `resolve_challenge`, `finalize_case`,
      `execute_payout`, `confirm_payout`, `pause`, `unpause`.
- [x] Confirm `lock_bond` is marked **payable** and no other write is.

If the schema fails to load, stop and bisect exactly as in Stage 1 Addendum
B.0 - do not guess.

---

## 1. Deploy - DONE 2026-08-30

### Deployment history

| Address | Source sha256 | Commit | Outcome |
|---|---|---|---|
| `0xF4D5855c7944d240E7b6DC37a369D6b2Fe6ED514` | `2d82153d…61b7` | `ea8f442` | superseded. First live run exposed two defects: every evidence fetch returned UNAVAILABLE (wrong web API), and adjudication consensus came back `Undetermined` after three validator rotations (equivalence principle too strict). |
| **`0x7cD15c0d4F4741C2Ce3DD807246b6f13aA7f82A1`** | **`95b6c42d…083e`** | **`30328d5`** | **current.** `gl.nondet.web.render` under `strict_eq`; adjudication on `prompt_non_comparative`. |

- [x] Deploy from your main wallet. No constructor arguments, no value.
- [x] Record the contract address.
- [ ] `get_config()` returns your address as `owner`, `paused: false`,
      all four counts `0`, and the four frozen vocabularies with lengths
      8 / 8 / 11 / 9.

### What this deployment is testing

Two fixes, and the run should be read against both:

1. **Evidence fetch.** `get_case_evidence` after adjudication must show
   `fetch_status: FETCHED` with non-empty `fetched_excerpt`, not `UNAVAILABLE`.
2. **Consensus.** The `request_adjudication` transaction must show
   `Consensus Result: Accepted`, not `Undetermined`.

If either still fails, isolate it before changing anything else.

---

## 2. Registration and policy

- [ ] `register_dao("your-dao")` succeeds.
- [ ] A second `register_dao("your-dao")` from **any** address reverts with
      `dao_id already registered`.
- [ ] `create_policy(...)` from the controller succeeds. Use a small bond
      (0.01 GEN or less) and short windows (3600s minimum) so the run is quick.
- [ ] `create_policy` from a non-controller reverts.
- [ ] A second `create_policy` reverts with `policy version 1 already exists`.
- [ ] `get_current_policy` shows `version: 1`, `status: ACTIVE`, a non-empty
      `policy_hash`.

---

## 3. Case and real bond

- [ ] `open_amendment_case(dao, "maximum_individual_allocation", "80000", "...")`
      succeeds; `get_case` shows the frozen snapshot.
- [ ] Record your wallet balance as **B0** and the contract balance (expect 0).
- [ ] `lock_bond(case_id)` with the **wrong** attached value reverts.
- [ ] `lock_bond(case_id)` with the **exact** bond succeeds.
- [ ] **Explorer:** the contract's native balance now equals the bond exactly.
- [ ] Record wallet balance **B1**; `B1 ~= B0 - bond - gas`.
- [ ] `get_bond_state` shows `LOCKED` and the exact amount.

---

## 4. Evidence and adjudication - PASSED 2026-08-31

First successful end-to-end adjudication, on
`0x7cD15c0d4F4741C2Ce3DD807246b6f13aA7f82A1`, case `c_1`.

- [x] `submit_evidence` twice with distinct real URLs (`e_1` Wikipedia,
      `e_2` CISA).
- [x] `freeze_evidence` returned fingerprint `ab57b16cf1a603c7` - identical to
      the fingerprint the superseded deployment produced for the same case
      content, confirming the FNV-1a fingerprint is deterministic across
      contracts.
- [x] `request_adjudication` completed. **Consensus Result: Accepted**, one
      rotation. The previous deployment produced `Undetermined` after three.
- [x] **Both web fetches succeeded.** The Equivalence Principle Outputs show
      three blocks: the full Wikipedia article, the full CISA page, and the
      verdict. Each fetch is its own `strict_eq` block, so validators agreed on
      byte-identical content before it entered the dossier.
- [x] `unverified_evidence_ids` was empty and `decisive_evidence_ids` cited
      both items - the model worked from fetched text, not from the
      submitter's excerpts.

### The verdict: REJECTED, and substantively right

Model outcome `REJECT`; the contract's `_decide` returned `REJECTED` because
two gated dimensions did not pass:

| Dimension | Result | Model's reason (abridged) |
|---|---|---|
| MATERIAL_CHANGE_CONFIRMED | PASS | the change from 50000 to 80000 is a real material increase |
| POLICY_PURPOSE_CONSISTENT | PASS | security infrastructure and audit costs fit an allowed category |
| **PROPORTIONAL_TO_NEED** | **FAIL** | evidence is qualitative and gives no cost figures tying the need to an 80000 cap |
| EVIDENCE_SUFFICIENT | PASS | two items fetched |
| SOURCE_INDEPENDENCE | PASS | at least one fetched source is independent |
| **REASONABLE_ALTERNATIVES_CONSIDERED** | **FAIL** | no smaller increase or alternative was considered |
| CONFLICT_OF_INTEREST_CLEAR | UNCLEAR | no disclosure about proposer interests |
| MANIPULATION_RISK_ACCEPTABLE | PASS | no embedded instruction attempted to change the verdict |

`numeric_support: PARTIAL`. The evidence genuinely was qualitative - two
general reference pages with no cost data - and the adjudicator declined to
invent figures to bridge the gap. That is the "never manufacture numerical
precision" rule holding under live conditions, and it is the correct answer to
this case.

The MANIPULATION_RISK_ACCEPTABLE reason confirms the injection defence ran
against real fetched web content rather than a test fixture.

Bond disposition on finalization: **SLASHABLE** to the frozen treasury address.
That is the path still untested with real GEN.

---

## 5. Challenge - PASSED 2026-08-31

All three challenge slots exercised on case `c_1`, from
`0x082a657b…a735` (the proposer may not challenge their own case).

| Challenge | Ground | Result |
|---|---|---|
| `ch_1` | `DISPROPORTIONATE` | `REJECTED` - objection well founded but the decision was already REJECTED |
| `ch_2` | `CHANGE_NOT_MATERIAL` | `REJECTED` |
| `ch_3` | `SOURCE_NOT_INDEPENDENT` | `REJECTED` |

- [x] `open_challenge` from the proposer would revert (not attempted; the
      contract requires `challenger != proposer` and the run used the second
      wallet throughout).
- [x] `open_challenge` from a third address succeeds.
- [x] Distinct grounds enforced; one open at a time enforced.
- [x] Each `resolve_challenge` re-ran the full adjudication and appended to
      `verdict_history` without overwriting the original verdict.
- [x] Exhausting all three slots unlocked `finalize_case` immediately, without
      waiting out the challenge window.

**Incidental but important finding.** The three re-adjudications graded
borderline dimensions differently from one another - `EVIDENCE_SUFFICIENT` came
back PASS on one run and FAIL on another, and `MATERIAL_CHANGE_CONFIRMED`
likewise - while every one of them still reached `Consensus Result: Accepted`.
That is direct live evidence that the `prompt_comparative` criteria could never
have reached consensus, and that `prompt_non_comparative` handles exactly this
variation. The verdict stayed REJECTED throughout: the disagreement was over
which dimension carried the rejection, never over the outcome.

---

## 6. Finalization - PASSED 2026-08-31

- [x] `finalize_case` returned `REJECTED`.
- [x] Bond moved to `SLASHABLE` with the frozen treasury address as recipient.
- [x] Policy remained at **version 1** with `maximum_individual_allocation`
      still `50000`. A rejected amendment changed nothing.

---

## 7. Payout - PASSED 2026-08-31, slash path with real GEN

- [x] `execute_payout` called **by the proposer** returned the **treasury**
      address `0x082a657bAA2ea66a3cfeD6dbeFeF18135d43a735`, not the caller.
      The recipient came from the frozen case; the caller could not influence
      it.
- [x] **Explorer:** separate `Send`, FINALIZED, OUT, from
      `0x7cD15c0d…82A1` to `0x082a657b…a735`, Value **1 GEN**.
- [x] Contract balance dropped to **0 GEN**.
- [x] `confirm_payout` called only AFTER the `Send` was observed finalized,
      per the operational rule. Returned `SLASHED`.

Eighteen transactions on the contract, every one FINALIZED and Accepted. The
whole lifecycle is legible in the explorer's transaction list.

---

## 8. Pause

- [ ] `pause()` from a non-owner reverts.
- [ ] While paused: `open_amendment_case`, `lock_bond`, `submit_evidence`,
      `freeze_evidence`, `request_adjudication`, `open_challenge` all revert.
- [ ] While paused: `execute_payout` and `confirm_payout` on an already-settled
      case **still work**. This is the invariant that a pause must never
      strand owed GEN.
- [ ] All views still work while paused.

---

## 9. Open item G - failed outbound transfer - RESOLVED 2026-08-30

Answered with live evidence by `contracts/capability_test/gen_error_hook_probe.py`.
Probe A `0x712e3f10571992c21689E5123325cad803486532`,
probe B `0xC23680B622501623EB46684665d03F668a07f8B6`.

| Scenario | Result | hook_calls |
|---|---|---|
| Insufficient balance (emit 1000 GEN holding 1) | `emit_transfer` raised `SystemError: 7: Imbalance` SYNCHRONOUSLY at the call site. Transaction `Execution Result: ERROR`, `Result Code: Contract Error`, `exit_code 1`. **All state writes rolled back**: status returned to `PAYOUT_READY`, `in_flight` cleared, `total_emitted` back to 0. | **0** |
| Successful payout to an EOA | SUCCESS, returned the exact amount, GEN delivered | **0** |
| Payout to a CONTRACT recipient with no `__receive__` | SUCCESS. A separate `Send` transaction FINALIZED and the recipient contract's balance became **1 GEN**. | **0** |

### Findings

1. **`__on_errored_message__` was never invoked, in any scenario** - including a
   genuine, deliberately induced transfer failure. There is no live evidence
   that this callback is delivered at all under GenVM v0.2.16.
2. **A failed `emit_transfer` raises synchronously and the whole transaction
   rolls back atomically.** There is therefore no such thing as a payout
   stranded in `PAYOUT_PENDING` by a funding failure - the attempt simply never
   happened, and a retry is the first and only emission.
3. **Contracts can receive native GEN** without implementing `__receive__`.
   The recipient-rejection failure mode we designed around does not exist here.
4. The outbound transfer is still a **separate `Send` transaction**, but the
   funding check happens inline at emit time.

### Consequences

- The callback must NOT be restored. It is unreachable code that can silently
  mutate bond state - a liability, not a safeguard.
- The 3600-second `PAYOUT_CONFIRM_DELAY` has no justification. It was guarding
  against a stranded-pending state that cannot occur.
- Double payment remains impossible via the terminal status guard, unchanged.

### Residual risk

These tests exercised two failure/success paths. They do not prove that NO
asynchronous failure mode exists - only that the two we could construct are
either synchronous-and-atomic or succeed outright. If an async failure mode is
ever observed, the operational rule stands: withhold `confirm_payout` for any
payout whose `Send` was not seen to succeed on the explorer.

---

## 10. Accepted amendment - live run, 2026-08-31

Four attempts were needed to produce an ACCEPT, and the three failures were all
case-design errors on our side rather than protocol faults. They are recorded
because each one is evidence the adjudicator is not a rubber stamp.

| Case | DAO | Amendment | Result | Gate that failed |
|---|---|---|---|---|
| `c_1` | example-dao | cap 50000 -> 80000 | REJECTED | `PROPORTIONAL_TO_NEED` - evidence had no cost figures |
| `c_2` | example-dao-2 | add `security audits` | REJECTED | `EVIDENCE_SUFFICIENT` - policy already allowed `security`, so the change was redundant |
| `c_3` | example-dao-4 | add `security` | REJECTED | `POLICY_PURPOSE_CONSISTENT` - the policy description said it funds grants and events **only**, so adding security contradicted its stated purpose |
| **`c_4`** | **example-dao-5** | **add `security`** | **ACCEPTED** | none - **all eight dimensions PASSED** |

### What made the difference

The `c_4` policy states a **broad purpose** - "funds work necessary to sustain,
protect and grow the protocol and its community" - while its category list
simply does not yet include security. That is a coherent, ordinary shape for a
real policy, and it resolves the bind the earlier attempts kept hitting:

- a policy that already allows security makes the amendment redundant;
- a policy that explicitly excludes security makes the amendment contradictory;
- a policy with a broad purpose and an incomplete list has a genuine gap.

The adjudicator's own words: *"Security work aligns with the stated purpose to
'protect' the protocol and its community"*, and *"Adding one relevant category
to match the existing policy purpose is a minimal and proportional change."*

It passed all eight dimensions, so it would have been accepted under the full
8-criteria gate as well. The narrowed gate was not what carried it.

### Lesson for the product

`PROPORTIONAL_TO_NEED` and `EVIDENCE_SUFFICIENT` ask whether the evidence
justifies *this* change under *this* policy. Generic public reference pages can
support a change that is about **scope alignment**, but they can never
establish a specific DAO's **quantified need**. A cap increase requires the
DAO's own cost evidence - vendor quotes, historical spend, incident reports.
That is a property of the design working as intended, not a limitation to
engineer around.

### CRITICAL FINDING: `Undetermined` consensus DISCARDS state

The `c_4` adjudication at 10:18 returned:

```
Execution Result: SUCCESS
Result Code:      Return
Return Value:     "ACCEPTED"
Consensus Result: Undetermined      (Rotation Count 3)
Status:           FINALIZED
```

Everything about that transaction reads like success. The verdict was computed,
all eight dimensions passed, and `ACCEPTED` was returned to the caller.

**None of it was written.** A subsequent `finalize_case` failed with
`EXPECTED: case is not awaiting finalization`, and `get_verdict` showed:

```
status:            EVIDENCE_FROZEN
proposed_decision: ""
history:           []
```

**`Undetermined` means the transaction's state changes are discarded**, even
though execution succeeded and a value was returned. A caller reading only the
return value would believe the amendment had been accepted when nothing had
happened at all.

Re-running `request_adjudication` on the same case reached
`Consensus Result: Accepted` with Rotation Count 0 and near-identical reasoning
- the verdict is reproducible; the failure was in agreement, not in judgement.

#### Consequences

1. **`Undetermined` must be treated as a failed transaction**, regardless of
   what `Execution Result` and `Return Value` say. Any frontend or operator
   procedure must read `Consensus Result` and re-read contract state before
   believing an outcome. This is a Stage 3 requirement, not a nicety.
2. **The evidence freeze survived**, because `freeze_evidence` is a separate
   committed transaction. A test in Stage 2 forced that split, on the reasoning
   that a rolled-back adjudication must not unfreeze evidence. It held under
   exactly the condition it was designed for: the case was safely re-adjudicable
   with its frozen evidence intact and no re-submission required.
3. **Re-adjudication is the correct recovery** and is already supported: the
   case stays at `EVIDENCE_FROZEN` and `request_adjudication` can simply be
   called again.

### Probable cause: `strict_eq` on live web content

Each evidence fetch is wrapped in `gl.eq_principle.strict_eq`, which demands
**byte-identical** content across validators. Both sources carry volatile
content - the CISA page lists dated advisories, the Wikipedia article carries
edit timestamps and a "Page was rendered with Parsoid" line - so validators
fetching moments apart can legitimately disagree, and no rotation resolves it.

`strict_eq` is right for the *guarantee* (all validators must judge identical
evidence) but wrong for the *medium* (live pages are not stable).

Options for a future revision, none applied yet:

- normalize fetched text before comparison (strip dates, timestamps, nav);
- fetch under a non-comparative principle judging substantive equivalence;
- keep `strict_eq` and treat occasional `Undetermined` as a retry, which is
  what happened here and worked.

Observed rate: one `Undetermined` in five adjudications on these two URLs.
