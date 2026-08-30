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
- [ ] Confirm the write methods listed are exactly: `register_dao`,
      `create_policy`, `open_amendment_case`, `lock_bond`, `withdraw_case`,
      `submit_evidence`, `freeze_evidence`, `request_adjudication`,
      `open_challenge`, `resolve_challenge`, `finalize_case`,
      `execute_payout`, `confirm_payout`, `pause`, `unpause`.
- [ ] Confirm `lock_bond` is marked **payable** and no other write is.

If the schema fails to load, stop and bisect exactly as in Stage 1 Addendum
B.0 - do not guess.

---

## 1. Deploy

- [ ] Deploy from your main wallet. No constructor arguments, no value.
- [ ] Record the contract address.
- [ ] `get_config()` returns your address as `owner`, `paused: false`,
      all four counts `0`, and the four frozen vocabularies with lengths
      8 / 8 / 11 / 9.

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
- [ ] `confirm_payout` before the delay reverts.
- [ ] After 1 hour, `confirm_payout` returns `REFUNDED` or `SLASHED`.
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

## 9. Open item G - failed outbound transfer

Still open, and now harder: `__on_errored_message__` cannot be used at all
because that dunder breaks Studio schema extraction. There is no in-contract
recovery path for a failed transfer.

- [ ] Settle a case, then `execute_payout` to a recipient that should cause the
      transfer to fail (for example a contract that rejects value - construct
      one deliberately as a probe, never as production code).
- [ ] Confirm the case stays at `PAYOUT_PENDING` with the amount, recipient and
      disposition intact.
- [ ] Confirm the contract's on-chain balance still holds the bond. This is the
      off-chain detection signal: contract balance versus unconfirmed
      settlements.
- [ ] Do **not** call `confirm_payout` on it. Confirm that withholding
      confirmation leaves the entitlement recorded indefinitely.
- [ ] Confirm no method reopens or re-emits it.

Until a Studio-loadable failure callback or a verified balance accessor exists,
the operational rule is: **never confirm a payout whose outbound transfer you
have not seen succeed on the explorer.** Record every transaction hash.
