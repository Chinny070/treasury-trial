"""
Semantic adjudication and the deterministic validator.

The model is never authoritative. Every test here either proves the contract
overrides the model, or proves malformed model output is rejected outright.
"""

import json

import pytest

from conftest import (
    DIMENSIONS, PROPOSER, adjudicate, bond_of, bonded_case_with_evidence,
    contract_module,
    case_of, create_policy, finalize, freeze, lock_bond, mock_adjudicator,
    mock_sources, open_case, register, reverts, seed_evidence, submit_evidence,
    verdict,
)


def _case(c, vm, **policy):
    register(c, vm)
    create_policy(c, vm, **policy)
    case_id = open_case(c, vm)
    lock_bond(c, vm, case_id)
    seed_evidence(c, vm, case_id, 2)
    return case_id


# --------------------------------------------------------------------------- #
# Frozen dimensions                                                            #
# --------------------------------------------------------------------------- #


def test_exactly_eight_frozen_dimensions(env):
    vm, c, _ = env
    assert json.loads(c.get_config())["dimensions"] == DIMENSIONS
    assert len(DIMENSIONS) == 8


def test_all_pass_and_model_accept_gives_accepted(env):
    vm, c, _ = env
    case_id = _case(c, vm)
    assert adjudicate(c, vm, case_id, verdict()) == "ACCEPTED"


@pytest.mark.parametrize("dimension", DIMENSIONS)
def test_any_gated_dimension_failing_forces_reject(env, dimension):
    vm, c, _ = env
    case_id = _case(c, vm)
    assert adjudicate(c, vm, case_id, verdict(results={dimension: "FAIL"})) == "REJECTED"
    assert case_of(c, case_id)["decision_reason"] == "GATE_FAILED:" + dimension


@pytest.mark.parametrize("dimension", DIMENSIONS)
def test_unclear_is_reject_never_invalid(env, dimension):
    """Model uncertainty must never be laundered into INVALID."""
    vm, c, _ = env
    case_id = _case(c, vm)
    assert adjudicate(c, vm, case_id, verdict(results={dimension: "UNCLEAR"})) == "REJECTED"


def test_model_accept_cannot_override_a_failed_gate(env):
    """The contract decides, not the model."""
    vm, c, _ = env
    case_id = _case(c, vm)
    result = verdict(outcome="ACCEPT", results={"MANIPULATION_RISK_ACCEPTABLE": "FAIL"})
    assert adjudicate(c, vm, case_id, result) == "REJECTED"


def test_only_criteria_the_policy_froze_are_gates(env):
    """A dimension the DAO did not adopt cannot by itself sink the amendment."""
    vm, c, _ = env
    case_id = _case(c, vm, criteria=["MATERIAL_CHANGE_CONFIRMED", "EVIDENCE_SUFFICIENT"])
    result = verdict(results={"REASONABLE_ALTERNATIVES_CONSIDERED": "FAIL"})
    assert adjudicate(c, vm, case_id, result) == "ACCEPTED"


def test_model_reject_is_honoured_even_with_all_gates_passing(env):
    vm, c, _ = env
    case_id = _case(c, vm)
    assert adjudicate(c, vm, case_id, verdict(outcome="REJECT")) == "REJECTED"
    assert case_of(c, case_id)["decision_reason"] == "MODEL_REJECT"


# --------------------------------------------------------------------------- #
# INVALID stays narrow                                                         #
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "reason",
    [
        "TARGET_FIELD_NOT_AMENDABLE",
        "PROPOSED_VALUE_MALFORMED",
        "MULTI_CHANGE_SMUGGLED",
        "EVIDENCE_SET_EMPTY_OR_UNFETCHABLE",
        "POLICY_FINGERPRINT_MISMATCH",
    ],
)
def test_canonical_invalid_reasons_accepted(env, reason):
    vm, c, _ = env
    case_id = _case(c, vm)
    result = verdict(outcome="INVALID", invalid_reason=reason)
    assert adjudicate(c, vm, case_id, result) == "INVALID"


@pytest.mark.parametrize(
    "reason",
    ["", "UNSURE", "HARD_QUESTION", "WEAK_EVIDENCE", "MODEL_UNCERTAIN", "OTHER"],
)
def test_non_canonical_invalid_reasons_rejected_outright(env, reason):
    """'The AI was unsure' cannot be dressed up as INVALID."""
    vm, c, _ = env
    case_id = _case(c, vm)
    with reverts():
        adjudicate(c, vm, case_id, verdict(outcome="INVALID", invalid_reason=reason))


def test_invalid_reason_must_be_empty_when_not_invalid(env):
    vm, c, _ = env
    case_id = _case(c, vm)
    with reverts("must be empty unless INVALID"):
        adjudicate(
            c, vm, case_id, verdict(outcome="ACCEPT", invalid_reason="PROPOSED_VALUE_MALFORMED")
        )


def test_invalid_bond_is_refundable(env):
    vm, c, _ = env
    case_id = _case(c, vm)
    adjudicate(c, vm, case_id, verdict(outcome="INVALID", invalid_reason="MULTI_CHANGE_SMUGGLED"))
    assert finalize(c, vm, case_id) == "INVALID"
    assert bond_of(c, case_id)["bond_status"] == "REFUNDABLE"


def test_deterministic_invalid_overrides_a_model_accept(env):
    """A structural defect found on-chain beats anything the model says."""
    vm, c, _ = env
    case_id = bonded_case_with_evidence(c, vm)
    freeze(c, vm, case_id)
    mock_adjudicator(vm, verdict(outcome="ACCEPT"))
    vm.sender = PROPOSER
    # No web mocks registered, so every source is UNAVAILABLE.
    assert c.request_adjudication(case_id) == "INVALID"
    assert case_of(c, case_id)["decision_reason"] == "EVIDENCE_SET_EMPTY_OR_UNFETCHABLE"


# --------------------------------------------------------------------------- #
# Strict validator                                                             #
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "payload",
    [
        "not json at all",
        "",
        "[]",
        '"a string"',
        "123",
        "```json\n{}\n```",
    ],
)
def test_non_object_output_rejected(env, payload):
    vm, c, _ = env
    case_id = _case(c, vm)
    with reverts():
        adjudicate(c, vm, case_id, payload)


@pytest.mark.parametrize(
    "key",
    [
        "outcome",
        "invalid_reason",
        "numeric_support",
        "dimensions",
        "decisive_evidence_ids",
        "unverified_evidence_ids",
        "manipulation_signals",
        "short_reason",
    ],
)
def test_missing_key_rejected(env, key):
    vm, c, _ = env
    case_id = _case(c, vm)
    with reverts("missing key in model output"):
        adjudicate(c, vm, case_id, verdict(drop=[key]))


def test_extra_key_rejected(env):
    # NOTE: the extra value is a string, not a float. gltest's LLM mock cannot
    # round-trip floats through calldata and silently yields None instead,
    # which would mask what this test is actually asserting.
    vm, c, _ = env
    case_id = _case(c, vm)
    with reverts("unexpected key in model output"):
        adjudicate(c, vm, case_id, verdict(extra={"confidence": "high"}))


@pytest.mark.parametrize("outcome", ["MAYBE", "accept", "ACCEPTED", "", "YES"])
def test_bad_outcome_vocabulary_rejected(env, outcome):
    vm, c, _ = env
    case_id = _case(c, vm)
    with reverts("invalid outcome vocabulary"):
        adjudicate(c, vm, case_id, verdict(outcome=outcome))


@pytest.mark.parametrize("support", ["HIGH", "", "none", "MEDIUM"])
def test_bad_numeric_support_vocabulary_rejected(env, support):
    vm, c, _ = env
    case_id = _case(c, vm)
    with reverts("invalid numeric_support"):
        adjudicate(c, vm, case_id, verdict(numeric_support=support))


def test_missing_dimension_rejected(env):
    vm, c, _ = env
    case_id = _case(c, vm)
    body = verdict()
    body["dimensions"].pop("PROPORTIONAL_TO_NEED")
    with reverts("exactly 8 entries"):
        adjudicate(c, vm, case_id, body)


def test_unknown_dimension_rejected(env):
    vm, c, _ = env
    case_id = _case(c, vm)
    body = verdict()
    body["dimensions"].pop("PROPORTIONAL_TO_NEED")
    body["dimensions"]["VIBES_ACCEPTABLE"] = {"result": "PASS", "reason": "ok"}
    with reverts("unknown dimension"):
        adjudicate(c, vm, case_id, body)


def test_bad_dimension_result_rejected(env):
    vm, c, _ = env
    case_id = _case(c, vm)
    with reverts("invalid dimension result"):
        adjudicate(c, vm, case_id, verdict(results={"EVIDENCE_SUFFICIENT": "MOSTLY"}))


def test_overlong_dimension_reason_rejected(env):
    vm, c, _ = env
    case_id = _case(c, vm)
    body = verdict()
    body["dimensions"]["EVIDENCE_SUFFICIENT"]["reason"] = "x" * 201
    with reverts("dimension reason too long"):
        adjudicate(c, vm, case_id, body)


def test_extra_key_inside_a_dimension_rejected(env):
    vm, c, _ = env
    case_id = _case(c, vm)
    body = verdict()
    body["dimensions"]["EVIDENCE_SUFFICIENT"]["score"] = 88
    with reverts("unexpected key in dimension"):
        adjudicate(c, vm, case_id, body)


def test_reference_to_unknown_evidence_rejected(env):
    vm, c, _ = env
    case_id = _case(c, vm)
    with reverts("references unknown evidence"):
        adjudicate(c, vm, case_id, verdict(decisive=["e_9999"]))


def test_duplicate_evidence_reference_rejected(env):
    vm, c, _ = env
    case_id = _case(c, vm)
    with reverts("duplicate reference"):
        adjudicate(c, vm, case_id, verdict(decisive=["e_1", "e_1"]))


def test_valid_evidence_references_accepted(env):
    vm, c, _ = env
    case_id = _case(c, vm)
    assert adjudicate(c, vm, case_id, verdict(decisive=["e_1"], unverified=["e_2"])) == "ACCEPTED"


def test_overlong_short_reason_rejected(env):
    vm, c, _ = env
    case_id = _case(c, vm)
    with reverts("short_reason too long"):
        adjudicate(c, vm, case_id, verdict(short_reason="x" * 301))


def test_empty_short_reason_rejected(env):
    vm, c, _ = env
    case_id = _case(c, vm)
    with reverts("short_reason must not be empty"):
        adjudicate(c, vm, case_id, verdict(short_reason="   "))


def test_too_many_manipulation_signals_rejected(env):
    vm, c, _ = env
    case_id = _case(c, vm)
    with reverts("manipulation_signals exceeds cap"):
        adjudicate(c, vm, case_id, verdict(signals=["s"] * 9))


def test_oversized_output_rejected(env):
    """
    Every individual field is within its cap; the assembled document is not.

    Exercised against the pure validator rather than through the LLM mock: the
    gltest mock re-serializes any JSON response compactly, so an oversized
    document cannot be delivered end to end in direct mode.
    """
    vm, c, _ = env
    module = contract_module(c)
    body = verdict(short_reason="x" * 299)
    body["manipulation_signals"] = ["y" * 200] * 8
    payload = json.dumps(body, indent=16)
    assert len(payload) > 4000
    with reverts("exceeds size cap"):
        module._validate_model_output(payload, ["e_1", "e_2"])


def test_validator_accepts_a_well_formed_document(env):
    vm, c, _ = env
    module = contract_module(c)
    parsed = module._validate_model_output(json.dumps(verdict(decisive=["e_1"])), ["e_1", "e_2"])
    assert parsed["outcome"] == "ACCEPT"


def test_validator_rejects_fenced_output(env):
    vm, c, _ = env
    module = contract_module(c)
    with reverts("must not be fenced"):
        module._validate_model_output("```json " + json.dumps(verdict()) + " ```", [])


def test_validator_rejects_non_string_dimension_reason(env):
    vm, c, _ = env
    module = contract_module(c)
    body = verdict()
    body["dimensions"]["EVIDENCE_SUFFICIENT"]["reason"] = 12
    with reverts("dimension reason too long"):
        module._validate_model_output(json.dumps(body), [])


def test_validator_rejects_non_list_reference_fields(env):
    vm, c, _ = env
    module = contract_module(c)
    body = verdict()
    body["decisive_evidence_ids"] = "e_1"
    with reverts("must be an array"):
        module._validate_model_output(json.dumps(body), ["e_1"])


def test_validator_rejects_too_many_references(env):
    vm, c, _ = env
    module = contract_module(c)
    ids = ["e_" + str(index) for index in range(13)]
    body = verdict(decisive=ids)
    with reverts("exceeds the reference cap"):
        module._validate_model_output(json.dumps(body), ids)


def test_rejected_output_leaves_no_verdict_behind(env):
    vm, c, _ = env
    case_id = _case(c, vm)
    with reverts():
        adjudicate(c, vm, case_id, verdict(extra={"bribe": "yes"}))
    case = case_of(c, case_id)
    assert case["current_verdict_json"] == ""
    assert case["proposed_decision"] == ""
    assert case["verdict_history"] == []


def test_retry_after_a_malformed_response_succeeds(env):
    vm, c, _ = env
    case_id = _case(c, vm)
    with reverts():
        adjudicate(c, vm, case_id, "garbage")
    vm.clear_mocks()
    assert adjudicate(c, vm, case_id, verdict(), do_freeze=False) == "ACCEPTED"


# --------------------------------------------------------------------------- #
# Verdict bookkeeping                                                          #
# --------------------------------------------------------------------------- #


def test_verdict_view_reports_history(env):
    vm, c, _ = env
    case_id = _case(c, vm)
    adjudicate(c, vm, case_id, verdict())
    view = json.loads(c.get_verdict(case_id))
    assert view["proposed_decision"] == "ACCEPTED"
    assert view["final_decision"] == ""
    assert len(view["history"]) == 1
    assert view["history"][0]["source"] == "ADJUDICATION"


def test_challenge_window_opens_on_a_proposed_verdict(env):
    vm, c, _ = env
    case_id = _case(c, vm)
    adjudicate(c, vm, case_id, verdict())
    case = case_of(c, case_id)
    assert case["status"] == "VERDICT_PROPOSED"
    assert case["challenge_window_ends"] > case["created_at"]


def test_adjudication_cannot_run_twice(env):
    vm, c, _ = env
    case_id = _case(c, vm)
    adjudicate(c, vm, case_id, verdict())
    with reverts("evidence must be frozen before adjudication"):
        adjudicate(c, vm, case_id, verdict(), do_freeze=False)
