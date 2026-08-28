"""
Real native GEN bond: custody accounting, disposition, payout, retry, replay.

Value movement itself is not simulated by the direct runner - it was proven on
live StudioNet in Stage 1 section 16. What these tests police is everything the
contract is responsible for: that exactly one transfer is emitted, for the
exact locked amount, to a recipient the caller cannot influence, never twice,
never before a disposition exists, and never lost when a transfer fails.
"""

import json

import pytest

from conftest import (
    BOND, CHALLENGER, OUTSIDER, PROPOSER, PROPOSER_HEX, TREASURY_HEX,
    adjudicate, bond_of, bonded_case_with_evidence, case_of, checksum,
    create_policy, finalize, lock_bond, open_case, register, reverts,
    seed_evidence, verdict, warp_to,
)

CONFIRM_DELAY = 3600


def _settled(c, vm, decision="ACCEPT", **kwargs):
    case_id = bonded_case_with_evidence(c, vm, **kwargs)
    if decision == "ACCEPT":
        result = verdict()
    elif decision == "REJECT":
        result = verdict(results={"EVIDENCE_SUFFICIENT": "FAIL"})
    else:
        result = verdict(outcome="INVALID", invalid_reason="PROPOSED_VALUE_MALFORMED")
    adjudicate(c, vm, case_id, result)
    finalize(c, vm, case_id)
    return case_id


# --------------------------------------------------------------------------- #
# Locking                                                                      #
# --------------------------------------------------------------------------- #


def test_bond_starts_at_none(env):
    vm, c, _ = env
    register(c, vm)
    create_policy(c, vm)
    case_id = open_case(c, vm)
    state = bond_of(c, case_id)
    assert state["bond_status"] == "NONE"
    assert state["amount"] == "0"
    assert state["recipient"] == ""


def test_bond_amount_comes_from_attached_value(env):
    vm, c, _ = env
    register(c, vm)
    create_policy(c, vm)
    case_id = open_case(c, vm)
    assert lock_bond(c, vm, case_id) == str(BOND)
    state = bond_of(c, case_id)
    assert state["bond_status"] == "LOCKED"
    assert state["amount"] == str(BOND)
    assert case_of(c, case_id)["status"] == "EVIDENCE_OPEN"


def test_lock_bond_takes_no_declared_amount(env):
    """
    A declared/received mismatch is structurally impossible: lock_bond has no
    amount parameter at all, so the only source of truth is gl.message.value.
    """
    vm, c, _ = env
    register(c, vm)
    create_policy(c, vm)
    case_id = open_case(c, vm)
    vm.sender = PROPOSER
    vm.value = BOND
    try:
        with pytest.raises(TypeError):
            c.lock_bond(case_id, str(BOND))
    finally:
        vm.value = 0


@pytest.mark.parametrize("attached", [0, BOND - 1, BOND + 1, 2 * BOND])
def test_wrong_attached_value_rejected(env, attached):
    vm, c, _ = env
    register(c, vm)
    create_policy(c, vm)
    case_id = open_case(c, vm)
    with reverts():
        lock_bond(c, vm, case_id, amount=attached)
    assert bond_of(c, case_id)["bond_status"] == "NONE"


def test_only_proposer_may_lock(env):
    vm, c, _ = env
    register(c, vm)
    create_policy(c, vm)
    case_id = open_case(c, vm)
    with reverts("only the proposer"):
        lock_bond(c, vm, case_id, sender=OUTSIDER)


def test_bond_cannot_be_locked_twice(env):
    vm, c, _ = env
    register(c, vm)
    create_policy(c, vm)
    case_id = open_case(c, vm)
    lock_bond(c, vm, case_id)
    with reverts():
        lock_bond(c, vm, case_id)


def test_adjudication_requires_a_locked_bond(env):
    vm, c, _ = env
    register(c, vm)
    create_policy(c, vm)
    case_id = open_case(c, vm)
    with reverts():
        c.request_adjudication(case_id)


def test_bond_amount_is_frozen_against_later_policy_changes(env):
    vm, c, _ = env
    first = _settled(c, vm, case={"field": "amendment_bond_requirement", "proposed": str(3 * BOND)})
    assert case_of(c, first)["final_decision"] == "ACCEPTED"
    assert json.loads(c.get_current_policy("example-dao"))["amendment_bond_requirement"] == 3 * BOND
    # The already-settled case still owes exactly what it locked.
    assert bond_of(c, first)["amount"] == str(BOND)


# --------------------------------------------------------------------------- #
# Disposition                                                                  #
# --------------------------------------------------------------------------- #


def test_accepted_is_refundable_to_the_proposer(env):
    vm, c, _ = env
    case_id = _settled(c, vm, "ACCEPT")
    state = bond_of(c, case_id)
    assert state["bond_status"] == "REFUNDABLE"
    assert state["disposition"] == "REFUND"
    assert state["recipient"] == checksum(PROPOSER_HEX)


def test_rejected_is_slashable_to_the_frozen_treasury(env):
    vm, c, _ = env
    case_id = _settled(c, vm, "REJECT")
    state = bond_of(c, case_id)
    assert state["bond_status"] == "SLASHABLE"
    assert state["disposition"] == "SLASH"
    assert state["recipient"] == checksum(TREASURY_HEX)


def test_invalid_is_refundable_not_slashable(env):
    """Locked decision: INVALID refunds. Only a substantive REJECT forfeits."""
    vm, c, _ = env
    case_id = _settled(c, vm, "INVALID")
    assert case_of(c, case_id)["final_decision"] == "INVALID"
    state = bond_of(c, case_id)
    assert state["bond_status"] == "REFUNDABLE"
    assert state["recipient"] == checksum(PROPOSER_HEX)


# --------------------------------------------------------------------------- #
# Payout                                                                       #
# --------------------------------------------------------------------------- #


def test_refund_emits_exactly_one_transfer_to_the_proposer(env):
    vm, c, transfers = env
    case_id = _settled(c, vm, "ACCEPT")
    vm.sender = OUTSIDER
    c.execute_payout(case_id)
    assert len(transfers.sent) == 1
    assert transfers.last()["value"] == BOND
    assert transfers.recipient_matches(PROPOSER_HEX)
    assert bond_of(c, case_id)["bond_status"] == "PAYOUT_PENDING"


def test_slash_emits_exactly_one_transfer_to_the_treasury(env):
    vm, c, transfers = env
    case_id = _settled(c, vm, "REJECT")
    vm.sender = OUTSIDER
    c.execute_payout(case_id)
    assert len(transfers.sent) == 1
    assert transfers.last()["value"] == BOND
    assert transfers.recipient_matches(TREASURY_HEX)


def test_payout_recipient_is_not_caller_chosen(env):
    """execute_payout takes only a case id. There is no recipient parameter."""
    vm, c, _ = env
    case_id = _settled(c, vm, "ACCEPT")
    vm.sender = OUTSIDER
    with pytest.raises(TypeError):
        c.execute_payout(case_id, checksum(TREASURY_HEX))


def test_payout_before_disposition_rejected(env):
    vm, c, transfers = env
    register(c, vm)
    create_policy(c, vm)
    case_id = open_case(c, vm)
    with reverts("no settled disposition"):
        c.execute_payout(case_id)
    lock_bond(c, vm, case_id)
    with reverts("no settled disposition"):
        c.execute_payout(case_id)
    assert transfers.sent == []


def test_second_payout_while_in_flight_rejected(env):
    vm, c, transfers = env
    case_id = _settled(c, vm, "ACCEPT")
    c.execute_payout(case_id)
    with reverts("already in flight"):
        c.execute_payout(case_id)
    assert len(transfers.sent) == 1


def test_confirm_then_payout_again_rejected(env):
    vm, c, transfers = env
    case_id = _settled(c, vm, "ACCEPT")
    c.execute_payout(case_id)
    warp_to(vm, bond_of(c, case_id)["emitted_at"] + CONFIRM_DELAY + 1)
    assert c.confirm_payout(case_id) == "REFUNDED"
    with reverts("already completed"):
        c.execute_payout(case_id)
    with reverts("already completed"):
        c.confirm_payout(case_id)
    assert len(transfers.sent) == 1


def test_confirm_requires_the_delay_to_elapse(env):
    vm, c, _ = env
    case_id = _settled(c, vm, "ACCEPT")
    c.execute_payout(case_id)
    with reverts("confirmation delay has not elapsed"):
        c.confirm_payout(case_id)


def test_confirm_without_an_in_flight_payout_rejected(env):
    vm, c, _ = env
    case_id = _settled(c, vm, "ACCEPT")
    with reverts("no payout is in flight"):
        c.confirm_payout(case_id)


def test_slash_confirms_to_slashed(env):
    vm, c, _ = env
    case_id = _settled(c, vm, "REJECT")
    c.execute_payout(case_id)
    warp_to(vm, bond_of(c, case_id)["emitted_at"] + CONFIRM_DELAY + 1)
    assert c.confirm_payout(case_id) == "SLASHED"


def test_payout_never_exceeds_the_locked_bond(env):
    vm, c, transfers = env
    case_id = _settled(c, vm, "ACCEPT")
    c.execute_payout(case_id)
    assert transfers.last()["value"] == int(case_of(c, case_id)["bond_amount"])


# --------------------------------------------------------------------------- #
# Failed outbound transfer                                                     #
# --------------------------------------------------------------------------- #


def test_emitted_transfer_does_not_book_as_complete(env):
    """
    Emitting is not delivering.

    Stage 1 established that the outbound transfer is a SEPARATE emitted
    transaction, so `execute_payout` cannot observe success. It must therefore
    leave the bond in PAYOUT_PENDING - never REFUNDED - and must preserve the
    exact amount and recipient for a possible retry.
    """
    vm, c, transfers = env
    case_id = _settled(c, vm, "ACCEPT")
    before = bond_of(c, case_id)
    c.execute_payout(case_id)
    state = bond_of(c, case_id)
    assert state["bond_status"] == "PAYOUT_PENDING"
    assert state["bond_status"] not in ("REFUNDED", "SLASHED")
    assert state["amount"] == before["amount"]
    assert state["recipient"] == before["recipient"]
    assert state["emitted_at"] > 0


def test_no_caller_driven_retry_while_in_flight(env):
    """
    There is deliberately no blind retry.

    Without a failure signal the contract cannot distinguish "not delivered"
    from "delivered", so a caller-driven retry would risk paying twice. A
    payout in flight is therefore refused outright.
    """
    vm, c, transfers = env
    case_id = _settled(c, vm, "ACCEPT")
    c.execute_payout(case_id)
    assert len(transfers.sent) == 1
    for _ in range(3):
        with reverts("already in flight"):
            c.execute_payout(case_id)
    assert len(transfers.sent) == 1


def test_stalled_payout_preserves_the_entitlement(env):
    """
    A payout that is emitted but never confirmed keeps everything needed to
    recover it: status, exact amount, recipient and disposition all survive,
    and the case can never be settled a second time.
    """
    vm, c, transfers = env
    case_id = _settled(c, vm, "ACCEPT")
    before = bond_of(c, case_id)
    c.execute_payout(case_id)
    state = bond_of(c, case_id)
    assert state["bond_status"] == "PAYOUT_PENDING"
    assert state["amount"] == before["amount"]
    assert state["recipient"] == before["recipient"]
    assert state["disposition"] == "REFUND"
    assert state["emitted_at"] > 0
    # Nothing books it as complete on its own.
    with reverts("confirmation delay has not elapsed"):
        c.confirm_payout(case_id)
    assert bond_of(c, case_id)["bond_status"] == "PAYOUT_PENDING"


def test_confirmation_is_a_separate_withholdable_step(env):
    """
    Confirmation is permissionless and separate precisely so it can be
    withheld when the outbound transfer was not observed to succeed.
    """
    vm, c, transfers = env
    case_id = _settled(c, vm, "ACCEPT")
    c.execute_payout(case_id)
    warp_to(vm, bond_of(c, case_id)["emitted_at"] + CONFIRM_DELAY + 1)
    vm.sender = OUTSIDER
    assert c.confirm_payout(case_id) == "REFUNDED"
    assert len(transfers.sent) == 1


def test_no_method_can_reopen_a_settled_payout(env):
    vm, c, _ = env
    case_id = _settled(c, vm, "ACCEPT")
    c.execute_payout(case_id)
    warp_to(vm, bond_of(c, case_id)["emitted_at"] + CONFIRM_DELAY + 1)
    c.confirm_payout(case_id)
    for forbidden in ["reopen_payout", "retry_payout", "reset_payout", "cancel_payout"]:
        assert forbidden not in dir(c)
    with reverts("already completed"):
        c.execute_payout(case_id)


def test_no_semantic_re_settlement_after_disposition(env):
    """A retryable payout must never reopen the semantic decision."""
    vm, c, _ = env
    case_id = _settled(c, vm, "ACCEPT")
    c.execute_payout(case_id)
    with reverts("not awaiting finalization"):
        c.finalize_case(case_id)
    assert case_of(c, case_id)["final_decision"] == "ACCEPTED"
    assert case_of(c, case_id)["status"] == "DECIDED"
