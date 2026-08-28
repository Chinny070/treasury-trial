"""Amendment cases: one field per case, frozen snapshots, no smuggling."""

import json

import pytest

from conftest import (
    BOND, DAO_ID, PROPOSER, PROPOSER_HEX, TREASURY_HEX, adjudicate, bond_of,
    bonded_case_with_evidence, case_of, checksum, create_policy, finalize,
    lock_bond, open_case, register, reverts, seed_evidence,
)

AMENDABLE = [
    ("maximum_individual_allocation", "80000"),
    ("amendment_bond_requirement", str(2 * BOND)),
    ("challenge_window_seconds", "86400"),
    ("evidence_window_seconds", "172800"),
    ("minimum_evidence_count", "4"),
    ("minimum_independent_sources", "2"),
    ("allowed_spending_categories.add", "security audits"),
    ("allowed_spending_categories.remove", "community events"),
]


def _setup(c, vm, **kwargs):
    register(c, vm)
    return create_policy(c, vm, **kwargs)


@pytest.mark.parametrize("field,proposed", AMENDABLE)
def test_every_canonical_field_can_be_proposed(env, field, proposed):
    vm, c, _ = env
    _setup(c, vm)
    case_id = open_case(c, vm, field=field, proposed=proposed)
    assert case_of(c, case_id)["target_field"] == field


def test_exactly_eight_amendable_fields(env):
    vm, c, _ = env
    config = json.loads(c.get_config())
    assert len(config["amendable_fields"]) == 8
    assert sorted(config["amendable_fields"]) == sorted([name for name, _ in AMENDABLE])


@pytest.mark.parametrize(
    "field",
    [
        "title",
        "description",
        "treasury_address",
        "reference_currency",
        "dao_id",
        "amendment_criteria",
        "required_evidence_categories",
        "allowed_spending_categories",
        "",
        "maximum_individual_allocation;amendment_bond_requirement",
    ],
)
def test_non_amendable_fields_rejected(env, field):
    vm, c, _ = env
    _setup(c, vm)
    with reverts():
        open_case(c, vm, field=field, proposed="1")


def test_multi_field_amendment_is_structurally_impossible(env):
    """
    The ABI takes ONE target_field and ONE proposed_value. There is no batch
    entry point, so a multi-change amendment cannot even be expressed.
    """
    vm, c, _ = env
    surface = dir(c)
    for batch in ["open_amendment_batch", "propose_changes", "amend_many"]:
        assert batch not in surface
    _setup(c, vm)
    with reverts():
        open_case(
            c,
            vm,
            field="maximum_individual_allocation",
            proposed=json.dumps({"max": 80000, "bond": 2}),
        )


def test_case_freezes_the_policy_snapshot(env):
    vm, c, _ = env
    policy_id = _setup(c, vm)
    policy = json.loads(c.get_policy(policy_id))
    case = case_of(c, open_case(c, vm))
    assert case["policy_id"] == policy_id
    assert case["policy_version"] == 1
    assert case["policy_hash"] == policy["policy_hash"]
    assert case["treasury_address"] == checksum(TREASURY_HEX)
    assert case["bond_amount"] == str(BOND)
    assert case["frozen_criteria"] == policy["amendment_criteria"]
    assert case["frozen_min_evidence"] == policy["minimum_evidence_count"]
    assert case["frozen_min_independent"] == policy["minimum_independent_sources"]
    assert case["frozen_challenge_window"] == policy["challenge_window_seconds"]
    assert case["old_value"] == "50000"
    assert case["proposed_value"] == "80000"
    assert case["proposer"] == checksum(PROPOSER_HEX)


def test_later_version_does_not_change_an_open_case_snapshot(env):
    """
    A case opened against v1 keeps judging under v1 even after v2 lands.

    Only one case is active per DAO at a time, so the sequence is: case A
    accepted (mints v2), then case B opens against v2. Case A's frozen record
    must still point at v1 with v1's fingerprint.
    """
    vm, c, _ = env
    first = bonded_case_with_evidence(c, vm)
    adjudicate(c, vm, first)
    finalize(c, vm, first)
    v1_snapshot = case_of(c, first)
    second = open_case(c, vm, proposed="95000")
    assert case_of(c, second)["policy_version"] == 2
    assert case_of(c, first)["policy_version"] == 1
    assert case_of(c, first)["policy_hash"] == v1_snapshot["policy_hash"]
    assert case_of(c, first)["old_value"] == "50000"


def test_numeric_delta_is_computed_on_chain(env):
    vm, c, _ = env
    _setup(c, vm)
    case = case_of(c, open_case(c, vm))
    assert case["numeric_delta"].startswith("50000 -> 80000")
    assert "increase" in case["numeric_delta"]
    assert "60.00 percent" in case["numeric_delta"]


def test_category_amendments_carry_no_fabricated_delta(env):
    vm, c, _ = env
    _setup(c, vm)
    case = case_of(
        c, open_case(c, vm, field="allowed_spending_categories.add", proposed="security audits")
    )
    assert case["numeric_delta"] == ""


def test_no_op_amendment_rejected(env):
    vm, c, _ = env
    _setup(c, vm)
    with reverts("equals current value"):
        open_case(c, vm, proposed="50000")


@pytest.mark.parametrize(
    "field,proposed",
    [
        ("challenge_window_seconds", "60"),
        ("challenge_window_seconds", "99999999"),
        ("minimum_evidence_count", "0"),
        ("minimum_evidence_count", "99"),
        ("minimum_independent_sources", "9"),
        ("amendment_bond_requirement", "0"),
        ("maximum_individual_allocation", "-1"),
        ("maximum_individual_allocation", "not-a-number"),
    ],
)
def test_out_of_range_values_rejected(env, field, proposed):
    vm, c, _ = env
    _setup(c, vm)
    with reverts():
        open_case(c, vm, field=field, proposed=proposed)


def test_min_independent_cannot_exceed_min_evidence(env):
    vm, c, _ = env
    _setup(c, vm, min_evidence=2, min_independent=1)
    with reverts("exceeds minimum_evidence_count"):
        open_case(c, vm, field="minimum_independent_sources", proposed="3")


def test_min_evidence_cannot_drop_below_min_independent(env):
    vm, c, _ = env
    _setup(c, vm, min_evidence=4, min_independent=3)
    with reverts("would drop below"):
        open_case(c, vm, field="minimum_evidence_count", proposed="2")


def test_cannot_remove_the_last_category(env):
    vm, c, _ = env
    _setup(c, vm, categories=["infrastructure"])
    with reverts("at least one spending category"):
        open_case(
            c, vm, field="allowed_spending_categories.remove", proposed="infrastructure"
        )


def test_cannot_add_a_category_that_already_exists(env):
    vm, c, _ = env
    _setup(c, vm)
    with reverts("already allowed"):
        open_case(c, vm, field="allowed_spending_categories.add", proposed="infrastructure")


def test_cannot_remove_a_category_that_is_absent(env):
    vm, c, _ = env
    _setup(c, vm)
    with reverts("not currently allowed"):
        open_case(c, vm, field="allowed_spending_categories.remove", proposed="yachts")


def test_only_one_active_case_per_dao(env):
    vm, c, _ = env
    _setup(c, vm)
    open_case(c, vm)
    with reverts("already has an active case"):
        open_case(c, vm, proposed="90000")


def test_active_case_slot_frees_after_finalization(env):
    vm, c, _ = env
    case_id = bonded_case_with_evidence(c, vm)
    adjudicate(c, vm, case_id)
    finalize(c, vm, case_id)
    assert json.loads(c.get_dao(DAO_ID))["active_case_id"] == ""
    assert open_case(c, vm, proposed="95000") != ""


def test_case_requires_an_existing_policy(env):
    vm, c, _ = env
    register(c, vm)
    with reverts("no policy yet"):
        open_case(c, vm)


def test_proposing_is_permissionless(env):
    vm, c, _ = env
    _setup(c, vm)
    from conftest import OUTSIDER

    case_id = open_case(c, vm, sender=OUTSIDER)
    assert case_of(c, case_id)["status"] == "DRAFT"


def test_rationale_is_bounded(env):
    vm, c, _ = env
    _setup(c, vm)
    with reverts():
        open_case(c, vm, rationale="x" * 1501)
    with reverts():
        open_case(c, vm, rationale="   ")


def test_withdraw_before_bond_and_slot_released(env):
    vm, c, _ = env
    _setup(c, vm)
    case_id = open_case(c, vm)
    vm.sender = PROPOSER
    assert c.withdraw_case(case_id) == case_id
    assert case_of(c, case_id)["status"] == "WITHDRAWN"
    assert json.loads(c.get_dao(DAO_ID))["active_case_id"] == ""


def test_bonded_case_cannot_be_withdrawn(env):
    vm, c, _ = env
    _setup(c, vm)
    case_id = open_case(c, vm)
    lock_bond(c, vm, case_id)
    vm.sender = PROPOSER
    with reverts("only a DRAFT case may be withdrawn"):
        c.withdraw_case(case_id)


def test_only_proposer_may_withdraw(env):
    vm, c, _ = env
    _setup(c, vm)
    case_id = open_case(c, vm)
    from conftest import OUTSIDER

    vm.sender = OUTSIDER
    with reverts("only the proposer may withdraw"):
        c.withdraw_case(case_id)


def test_case_listing_is_paginated(env):
    vm, c, _ = env
    _setup(c, vm)
    case_id = open_case(c, vm)
    vm.sender = PROPOSER
    c.withdraw_case(case_id)
    open_case(c, vm, proposed="90000")
    listing = json.loads(c.list_cases(DAO_ID, "0", "1"))
    assert listing["total"] == 2
    assert len(listing["items"]) == 1
    with reverts():
        c.list_cases(DAO_ID, "0", "51")


def test_unknown_case_lookups_revert(env):
    vm, c, _ = env
    with reverts("case not found"):
        c.get_case("c_999")
    with reverts("case not found"):
        c.get_bond_state("c_999")
