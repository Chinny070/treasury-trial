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

## 4. Evidence and adjudication (live model + live web)

Use real, publicly fetchable URLs.

- [ ] `submit_evidence` twice with distinct real URLs.
- [ ] A duplicate URL variant (`http`, `www.`, trailing slash, `?utm_source=`)
      reverts with `duplicate source url`.
- [ ] `freeze_evidence(case_id)` returns a fingerprint; a further
      `submit_evidence` reverts.
- [ ] `request_adjudication(case_id)` completes. **This is the first live test
      of `gl.get_webpage` + `gl.eq_principle.prompt_comparative` in this
      contract** - note the transaction time and whether validators reached
      consensus.
- [ ] `get_case_evidence` shows `fetch_status: FETCHED` and a non-empty
      `fetched_excerpt` no longer than 3000 chars.
- [ ] `get_verdict` shows a decision and a one-entry history.
- [ ] If the model returns malformed JSON, confirm the transaction **rolls
      back** and the case stays `EVIDENCE_FROZEN` with no verdict - the freeze
      must survive.

---

## 5. Challenge

- [ ] `open_challenge` from the proposer reverts.
- [ ] `open_challenge` from a third address succeeds.
- [ ] A second challenge while the first is open reverts.
- [ ] `resolve_challenge` completes and appends to `verdict_history` without
      overwriting the first entry.
- [ ] Reusing the same ground reverts.

---

## 6. Finalization

- [ ] `finalize_case` before the window closes reverts.
- [ ] After the window, `finalize_case` succeeds from **any** address.
- [ ] On ACCEPTED: `get_current_policy` shows `version: 2`; the v1 record is
      unchanged except `status: SUPERSEDED`.
- [ ] A second `finalize_case` reverts.
- [ ] `get_bond_state` shows `REFUNDABLE` (ACCEPTED/INVALID) or `SLASHABLE`
      (REJECTED) with the correct recipient.

---

## 7. Payout - the part that matters

- [ ] `execute_payout(case_id)` succeeds.
- [ ] **Explorer:** a separate `Send` transaction appears,
      **From the contract -> To the expected recipient**, for the exact bond.
- [ ] The contract's native balance drops to 0.
- [ ] The recipient's balance rises by exactly the bond.
- [ ] A second `execute_payout` reverts with `already in flight`.
- [ ] **Only after seeing the outbound `Send` succeed and finalize above**,
      `confirm_payout` returns `REFUNDED` or `SLASHED`. There is no time gate;
      the wait is on YOUR observation, not on a clock.
- [ ] `execute_payout` after confirmation reverts with `already completed`.
- [ ] Total outbound transfers from the contract for this case: **exactly one**.

Run the whole of section 7 twice: once for a refund (ACCEPTED) and once for a
slash (REJECTED), confirming the slash lands at the frozen treasury address and
**not** back at the proposer.

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
