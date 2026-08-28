"""DAO registration: first-registrant ownership and the limits of that power."""

import json

import pytest

from conftest import (
    CONTROLLER, CONTROLLER_HEX, DAO_ID, OUTSIDER, PROPOSER, checksum,
    create_policy, register, reverts,
)


def test_first_registrant_claims_the_name(env):
    vm, c, _ = env
    assert register(c, vm) == DAO_ID
    assert c.get_dao_controller(DAO_ID) == checksum(CONTROLLER_HEX)


def test_duplicate_registration_rejected(env):
    vm, c, _ = env
    register(c, vm)
    vm.sender = OUTSIDER
    with reverts("dao_id already registered"):
        c.register_dao(DAO_ID)


def test_duplicate_rejected_even_for_the_original_controller(env):
    vm, c, _ = env
    register(c, vm)
    with reverts("dao_id already registered"):
        register(c, vm)


@pytest.mark.parametrize(
    "dao_id",
    ["", "   ", "Has-Caps", "has space", "bad!", "...", "a" * 65],
)
def test_malformed_dao_ids_rejected(env, dao_id):
    vm, c, _ = env
    vm.sender = CONTROLLER
    with reverts():
        c.register_dao(dao_id)


def test_unregistered_dao_has_no_controller(env):
    vm, c, _ = env
    with reverts("dao_id not registered"):
        c.get_dao_controller("never-registered")


def test_only_controller_may_create_the_first_policy(env):
    vm, c, _ = env
    register(c, vm)
    with reverts("only the dao controller"):
        create_policy(c, vm, sender=PROPOSER)


def test_controller_cannot_mint_a_second_version_directly(env):
    vm, c, _ = env
    register(c, vm)
    create_policy(c, vm)
    with reverts("policy version 1 already exists"):
        create_policy(c, vm)


def test_policy_requires_registration_first(env):
    vm, c, _ = env
    with reverts("dao_id not registered"):
        create_policy(c, vm)


def test_controller_has_no_case_or_fund_powers_in_the_abi(env):
    """
    The controller's only power is squatting protection.

    Asserted structurally: there is no public method that lets any address
    edit a policy, set a verdict, or choose a payout recipient.
    """
    vm, c, _ = env
    surface = dir(c)
    for forbidden in [
        "edit_policy",
        "update_policy",
        "set_verdict",
        "override_decision",
        "force_refund",
        "force_slash",
        "withdraw",
        "sweep",
        "transfer_dao",
    ]:
        assert forbidden not in surface


def test_dao_metadata_view(env):
    vm, c, _ = env
    register(c, vm)
    create_policy(c, vm)
    meta = json.loads(c.get_dao(DAO_ID))
    assert meta["dao_id"] == DAO_ID
    assert meta["controller"] == checksum(CONTROLLER_HEX)
    assert meta["version_count"] == 1
    assert meta["case_count"] == 0
    assert meta["active_case_id"] == ""
    assert meta["current_policy_id"] != ""
