"""Challenges: bounded grounds, no model shopping, history preserved."""

import json

import pytest

from conftest import (
    CHALLENGER, OUTSIDER, PROPOSER, adjudicate, bonded_case_with_evidence,
    case_of, create_policy, freeze, lock_bond, mock_adjudicator, mock_sources,
    open_case, register, reverts, seed_evidence, verdict, warp_to,
)

GROUNDS = [
    "EVIDENCE_FABRICATED",
    "SOURCE_NOT_INDEPENDENT",
    "SAME_SOURCE_MULTIPLE_URLS",
    "CHANGE_NOT_MATERIAL",
    "DISPROPORTIONATE",
    "MULTI_CHANGE_SMUGGLED",
    "CONFLICT_OF_INTEREST",
    "INJECTION_IN_EVIDENCE",
    "POLICY_PURPOSE_VIOLATION",
]


def _proposed(c, vm, result=None):
    case_id = bonded_case_with_evidence(c, vm)
    adjudicate(c, vm, case_id, result if result is not None else verdict())
    return case_id


def _challenge(c, vm, case_id, ground="EVIDENCE_FABRICATED", sender=CHALLENGER, refs=None,
               statement="The cited source does not say what is claimed."):
    vm.sender = sender
    return c.open_challenge(case_id, ground, statement, json.dumps(refs or []))


def _resolve(c, vm, case_id, challenge_id, result=None, sender=OUTSIDER):
    # Mocks accumulate and the first registered pattern wins, so a
    # re-adjudication must start from a clean registry to install its own
    # response rather than replaying the original adjudication's.
    vm.clear_mocks()
    mock_sources(vm)
    mock_adjudicator(vm, result if result is not None else verdict())
    vm.sender = sender
    return c.resolve_challenge(case_id, challenge_id)


# --------------------------------------------------------------------------- #
# Opening                                                                      #
# --------------------------------------------------------------------------- #


def test_nine_canonical_grounds(env):
    vm, c, _ = env
    assert json.loads(c.get_config())["challenge_grounds"] == GROUNDS


@pytest.mark.parametrize("ground", GROUNDS)
def test_every_canonical_ground_can_be_raised(env, ground):
    vm, c, _ = env
    case_id = _proposed(c, vm)
    assert _challenge(c, vm, case_id, ground=ground) != ""


@pytest.mark.parametrize("ground", ["MADE_UP", "", "evidence_fabricated", "I_DISAGREE"])
def test_unknown_grounds_rejected(env, ground):
    vm, c, _ = env
    case_id = _proposed(c, vm)
    with reverts("unknown challenge ground"):
        _challenge(c, vm, case_id, ground=ground)


def test_proposer_cannot_challenge_own_case(env):
    vm, c, _ = env
    case_id = _proposed(c, vm)
    with reverts("may not challenge their own case"):
        _challenge(c, vm, case_id, sender=PROPOSER)


def test_challenging_is_otherwise_permissionless(env):
    vm, c, _ = env
    case_id = _proposed(c, vm)
    assert _challenge(c, vm, case_id, sender=OUTSIDER) != ""


def test_cannot_challenge_before_a_verdict_exists(env):
    vm, c, _ = env
    case_id = bonded_case_with_evidence(c, vm)
    with reverts("no proposed verdict to challenge"):
        _challenge(c, vm, case_id)


def test_cannot_challenge_after_the_window_closes(env):
    vm, c, _ = env
    case_id = _proposed(c, vm)
    warp_to(vm, int(case_of(c, case_id)["challenge_window_ends"]) + 1)
    with reverts("challenge window has closed"):
        _challenge(c, vm, case_id)


def test_statement_is_bounded(env):
    vm, c, _ = env
    case_id = _proposed(c, vm)
    with reverts():
        _challenge(c, vm, case_id, statement="x" * 1001)
    with reverts():
        _challenge(c, vm, case_id, statement="   ")


# --------------------------------------------------------------------------- #
# Anti model shopping                                                          #
# --------------------------------------------------------------------------- #


def test_same_ground_cannot_be_reused(env):
    vm, c, _ = env
    case_id = _proposed(c, vm)
    first = _challenge(c, vm, case_id, ground="DISPROPORTIONATE")
    _resolve(c, vm, case_id, first, verdict())
    with reverts("already been challenged"):
        _challenge(c, vm, case_id, ground="DISPROPORTIONATE")


def test_only_one_challenge_open_at_a_time(env):
    vm, c, _ = env
    case_id = _proposed(c, vm)
    _challenge(c, vm, case_id, ground="DISPROPORTIONATE")
    with reverts("earlier challenge is still open"):
        _challenge(c, vm, case_id, ground="CHANGE_NOT_MATERIAL")


def test_challenge_cap_is_three(env):
    vm, c, _ = env
    case_id = _proposed(c, vm)
    for ground in GROUNDS[:3]:
        challenge_id = _challenge(c, vm, case_id, ground=ground)
        _resolve(c, vm, case_id, challenge_id, verdict())
    with reverts("challenge cap reached"):
        _challenge(c, vm, case_id, ground=GROUNDS[3])


def test_resolved_challenge_cannot_be_resolved_again(env):
    vm, c, _ = env
    case_id = _proposed(c, vm)
    challenge_id = _challenge(c, vm, case_id)
    _resolve(c, vm, case_id, challenge_id)
    with reverts("already resolved"):
        _resolve(c, vm, case_id, challenge_id)


def test_challenge_from_another_case_rejected(env):
    vm, c, _ = env
    case_id = _proposed(c, vm)
    challenge_id = _challenge(c, vm, case_id)
    with reverts("challenge not found"):
        _resolve(c, vm, case_id, "ch_999")
    assert json.loads(c.get_challenge(challenge_id))["case_id"] == case_id


# --------------------------------------------------------------------------- #
# Evidence references                                                          #
# --------------------------------------------------------------------------- #


def test_challenge_may_cite_frozen_evidence(env):
    vm, c, _ = env
    case_id = _proposed(c, vm)
    challenge_id = _challenge(c, vm, case_id, refs=["e_1", "e_2"])
    assert json.loads(c.get_challenge(challenge_id))["evidence_refs"] == ["e_1", "e_2"]


def test_challenge_cannot_cite_unfrozen_evidence(env):
    vm, c, _ = env
    case_id = _proposed(c, vm)
    with reverts("references unfrozen evidence"):
        _challenge(c, vm, case_id, refs=["e_999"])


def test_challenge_cannot_repeat_a_reference(env):
    vm, c, _ = env
    case_id = _proposed(c, vm)
    with reverts("duplicate evidence reference"):
        _challenge(c, vm, case_id, refs=["e_1", "e_1"])


def test_challenge_does_not_unfreeze_evidence(env):
    vm, c, _ = env
    case_id = _proposed(c, vm)
    before = case_of(c, case_id)
    _challenge(c, vm, case_id)
    after = case_of(c, case_id)
    assert after["evidence_frozen"] is True
    assert after["evidence_fingerprint"] == before["evidence_fingerprint"]
    assert after["frozen_evidence_ids"] == before["frozen_evidence_ids"]
    from conftest import submit_evidence

    with reverts("not accepting evidence"):
        submit_evidence(c, vm, case_id, url="https://example.org/smuggled")


# --------------------------------------------------------------------------- #
# Outcomes: UPHELD / PARTIAL / REJECTED                                        #
# --------------------------------------------------------------------------- #


def test_rejected_challenge_leaves_the_verdict_standing(env):
    vm, c, _ = env
    case_id = _proposed(c, vm, verdict())
    challenge_id = _challenge(c, vm, case_id)
    assert _resolve(c, vm, case_id, challenge_id, verdict()) == "REJECTED"
    assert case_of(c, case_id)["proposed_decision"] == "ACCEPTED"


def test_upheld_challenge_replaces_the_verdict(env):
    vm, c, _ = env
    case_id = _proposed(c, vm, verdict())
    challenge_id = _challenge(c, vm, case_id)
    result = _resolve(c, vm, case_id, challenge_id, verdict(results={"EVIDENCE_SUFFICIENT": "FAIL"}))
    assert result == "UPHELD"
    assert case_of(c, case_id)["proposed_decision"] == "REJECTED"


def test_partial_challenge_when_re_adjudication_accepts(env):
    vm, c, _ = env
    case_id = _proposed(c, vm, verdict(results={"PROPORTIONAL_TO_NEED": "FAIL"}))
    assert case_of(c, case_id)["proposed_decision"] == "REJECTED"
    challenge_id = _challenge(c, vm, case_id)
    assert _resolve(c, vm, case_id, challenge_id, verdict()) == "PARTIAL"
    assert case_of(c, case_id)["proposed_decision"] == "ACCEPTED"


def test_history_preserves_the_original_verdict(env):
    vm, c, _ = env
    case_id = _proposed(c, vm, verdict())
    challenge_id = _challenge(c, vm, case_id)
    _resolve(c, vm, case_id, challenge_id, verdict(results={"EVIDENCE_SUFFICIENT": "FAIL"}))
    history = json.loads(c.get_verdict(case_id))["history"]
    assert len(history) == 2
    assert history[0]["source"] == "ADJUDICATION"
    assert history[0]["decision"] == "ACCEPTED"
    assert history[1]["source"] == "CHALLENGE:" + challenge_id
    assert history[1]["decision"] == "REJECTED"
    assert history[1]["result"] == "UPHELD"


def test_challenge_record_keeps_its_own_replacement_verdict(env):
    vm, c, _ = env
    case_id = _proposed(c, vm, verdict())
    challenge_id = _challenge(c, vm, case_id)
    _resolve(c, vm, case_id, challenge_id, verdict(results={"EVIDENCE_SUFFICIENT": "FAIL"}))
    record = json.loads(c.get_challenge(challenge_id))
    assert record["status"] == "RESOLVED"
    assert record["result"] == "UPHELD"
    assert record["replacement_decision"] == "REJECTED"
    assert record["result_json"] != ""


def test_case_challenge_listing(env):
    vm, c, _ = env
    case_id = _proposed(c, vm)
    first = _challenge(c, vm, case_id, ground="DISPROPORTIONATE")
    _resolve(c, vm, case_id, first)
    _challenge(c, vm, case_id, ground="CHANGE_NOT_MATERIAL")
    listing = json.loads(c.get_case_challenges(case_id))
    assert listing["total"] == 2


def test_malformed_challenge_readjudication_rolls_back(env):
    vm, c, _ = env
    case_id = _proposed(c, vm, verdict())
    challenge_id = _challenge(c, vm, case_id)
    with reverts():
        _resolve(c, vm, case_id, challenge_id, "not json")
    assert json.loads(c.get_challenge(challenge_id))["status"] == "OPEN"
    assert case_of(c, case_id)["proposed_decision"] == "ACCEPTED"


def test_no_challenger_bond_in_v1(env):
    """V1 is proposer-bond only: open_challenge is not payable."""
    vm, c, _ = env
    case_id = _proposed(c, vm)
    vm.sender = CHALLENGER
    vm.value = 10 ** 18
    try:
        challenge_id = c.open_challenge(case_id, "DISPROPORTIONATE", "no bond required", "[]")
        assert challenge_id != ""
        assert "bond" not in json.loads(c.get_challenge(challenge_id))
    finally:
        vm.value = 0
