"""Policy versioning: monotonic versions and historical immutability."""

import json

from conftest import (
    DAO_ID, adjudicate, bonded_case_with_evidence, case_of, current_policy,
    finalize, policy_of, register, create_policy, reverts,
)


def _accepted_amendment(c, vm, setup=True, **case_kwargs):
    case_id = bonded_case_with_evidence(c, vm, setup=setup, case=case_kwargs)
    adjudicate(c, vm, case_id)
    finalize(c, vm, case_id)
    return case_id


def test_version_one_is_active_and_has_no_predecessor(env):
    vm, c, _ = env
    register(c, vm)
    policy_id = create_policy(c, vm)
    policy = policy_of(c, policy_id)
    assert policy["version"] == 1
    assert policy["previous_policy_id"] == ""
    assert policy["status"] == "ACTIVE"
    assert policy["created_by_case_id"] == ""
    assert policy["policy_hash"] != ""


def test_accept_mints_a_new_version_and_supersedes_the_old(env):
    vm, c, _ = env
    case_id = _accepted_amendment(c, vm)
    case = case_of(c, case_id)
    new_policy = policy_of(c, case["resulting_policy_id"])
    old_policy = policy_of(c, case["policy_id"])
    assert new_policy["version"] == 2
    assert new_policy["previous_policy_id"] == old_policy["policy_id"]
    assert new_policy["created_by_case_id"] == case_id
    assert new_policy["status"] == "ACTIVE"
    assert old_policy["status"] == "SUPERSEDED"
    assert current_policy(c)["policy_id"] == new_policy["policy_id"]


def test_old_version_substance_is_never_rewritten(env):
    vm, c, _ = env
    register(c, vm)
    policy_id = create_policy(c, vm)
    before = policy_of(c, policy_id)
    _accepted_amendment(c, vm, setup=False)
    after = policy_of(c, policy_id)
    for field in [
        "maximum_individual_allocation",
        "allowed_spending_categories",
        "amendment_bond_requirement",
        "policy_hash",
        "version",
        "created_at",
    ]:
        assert after[field] == before[field]
    # Only the current-version pointer flag changes.
    assert after["status"] == "SUPERSEDED"


def test_reject_leaves_the_policy_untouched(env):
    vm, c, _ = env
    from conftest import verdict

    register(c, vm)
    policy_id = create_policy(c, vm)
    from conftest import open_case, lock_bond, seed_evidence

    case_id = open_case(c, vm)
    lock_bond(c, vm, case_id)
    seed_evidence(c, vm, case_id, 2)
    adjudicate(c, vm, case_id, verdict(results={"PROPORTIONAL_TO_NEED": "FAIL"}))
    assert finalize(c, vm, case_id) == "REJECTED"
    assert current_policy(c)["policy_id"] == policy_id
    assert current_policy(c)["version"] == 1
    assert case_of(c, case_id)["resulting_policy_id"] == ""


def test_history_is_append_only_and_walkable(env):
    vm, c, _ = env
    _accepted_amendment(c, vm)
    _accepted_amendment(c, vm, setup=False, proposed="90000")
    history = json.loads(c.get_policy_history(DAO_ID, "0", "10"))
    assert history["total"] == 3
    versions = [item["version"] for item in history["items"]]
    assert versions == [3, 2, 1]
    allocations = [item["maximum_individual_allocation"] for item in history["items"]]
    assert allocations == [90000, 80000, 50000]


def test_history_pagination_is_bounded(env):
    vm, c, _ = env
    _accepted_amendment(c, vm)
    page = json.loads(c.get_policy_history(DAO_ID, "1", "1"))
    assert page["total"] == 2
    assert len(page["items"]) == 1
    assert page["items"][0]["version"] == 1
    with reverts():
        c.get_policy_history(DAO_ID, "0", "51")


def test_category_add_and_remove_produce_new_versions(env):
    vm, c, _ = env
    _accepted_amendment(
        c, vm, field="allowed_spending_categories.add", proposed="security audits"
    )
    assert "security audits" in current_policy(c)["allowed_spending_categories"]
    _accepted_amendment(
        c,
        vm,
        setup=False,
        field="allowed_spending_categories.remove",
        proposed="community events",
    )
    latest = current_policy(c)
    assert "community events" not in latest["allowed_spending_categories"]
    assert latest["version"] == 3


def test_amending_a_window_changes_only_that_field(env):
    vm, c, _ = env
    register(c, vm)
    policy_id = create_policy(c, vm)
    before = policy_of(c, policy_id)
    from conftest import open_case, lock_bond, seed_evidence

    case_id = open_case(c, vm, field="challenge_window_seconds", proposed="86400")
    lock_bond(c, vm, case_id)
    seed_evidence(c, vm, case_id, 2)
    adjudicate(c, vm, case_id)
    finalize(c, vm, case_id)
    after = current_policy(c)
    assert after["challenge_window_seconds"] == 86400
    for field in [
        "maximum_individual_allocation",
        "amendment_bond_requirement",
        "evidence_window_seconds",
        "minimum_evidence_count",
        "allowed_spending_categories",
    ]:
        assert after[field] == before[field]


def test_policy_fingerprint_changes_between_versions(env):
    vm, c, _ = env
    case_id = _accepted_amendment(c, vm)
    case = case_of(c, case_id)
    assert policy_of(c, case["policy_id"])["policy_hash"] != policy_of(
        c, case["resulting_policy_id"]
    )["policy_hash"]
