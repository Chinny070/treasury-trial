"""Smoke: the full happy path end to end."""

import json

from conftest import (
    BOND, PROPOSER_HEX, adjudicate, bond_of, bonded_case_with_evidence,
    case_of, current_policy, finalize,
)


def test_happy_path_accept(env):
    vm, c, transfers = env
    case_id = bonded_case_with_evidence(c, vm)
    assert adjudicate(c, vm, case_id) == "ACCEPTED"
    assert finalize(c, vm, case_id) == "ACCEPTED"
    assert bond_of(c, case_id)["bond_status"] == "REFUNDABLE"
    assert current_policy(c)["version"] == 2
    assert current_policy(c)["maximum_individual_allocation"] == 80000
    c.execute_payout(case_id)
    assert transfers.last()["value"] == BOND
