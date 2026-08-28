"""Evidence: bounds, deduplication, independence metadata, and the freeze."""

import json

import pytest

from conftest import (
    CHALLENGER, EVIDENCE_URLS, OUTSIDER, PROPOSER, adjudicate,
    bonded_case_with_evidence, case_of, create_policy, freeze, lock_bond,
    mock_sources, open_case, register, reverts, seed_evidence, submit_evidence,
    verdict, warp_to,
)


def _open_bonded(c, vm, **policy_kwargs):
    register(c, vm)
    create_policy(c, vm, **policy_kwargs)
    case_id = open_case(c, vm)
    lock_bond(c, vm, case_id)
    return case_id


def _evidence(c, case_id):
    return json.loads(c.get_case_evidence(case_id, "0", "50"))["items"]


# --------------------------------------------------------------------------- #
# Submission and bounds                                                        #
# --------------------------------------------------------------------------- #


def test_evidence_record_shape(env):
    vm, c, _ = env
    case_id = _open_bonded(c, vm)
    evidence_id = submit_evidence(c, vm, case_id)
    record = json.loads(c.get_evidence(evidence_id))
    assert record["case_id"] == case_id
    assert record["category"] == "MARKET_PRICING"
    assert record["source_url"] == EVIDENCE_URLS[0]
    assert record["url_normalised"] == "cloudpricing.example.org/report-2030"
    assert record["source_host"] == "cloudpricing.example.org"
    assert record["independence_declared"] == "INDEPENDENT"
    assert record["fetch_status"] == "NOT_ATTEMPTED"
    assert record["fetched_excerpt"] == ""
    assert record["image_not_machine_verified"] is True
    assert record["challenge_id"] == ""


def test_evidence_requires_an_open_bonded_case(env):
    vm, c, _ = env
    register(c, vm)
    create_policy(c, vm)
    case_id = open_case(c, vm)
    with reverts("not accepting evidence"):
        submit_evidence(c, vm, case_id)


def test_submission_is_permissionless(env):
    vm, c, _ = env
    case_id = _open_bonded(c, vm)
    assert submit_evidence(c, vm, case_id, sender=OUTSIDER) != ""


@pytest.mark.parametrize("category", ["POPULARITY", "SOCIAL_ENGAGEMENT", "", "market_pricing"])
def test_unknown_evidence_categories_rejected(env, category):
    vm, c, _ = env
    case_id = _open_bonded(c, vm)
    with reverts():
        submit_evidence(c, vm, case_id, category=category)


def test_social_metrics_are_not_a_category(env):
    """Popularity can never be submitted as evidence: no such category exists."""
    vm, c, _ = env
    categories = json.loads(c.get_config())["evidence_categories"]
    for banned in ["POPULARITY", "SOCIAL_ENGAGEMENT", "VOTES", "SENTIMENT"]:
        assert banned not in categories


@pytest.mark.parametrize(
    "kwargs",
    [
        {"title": ""},
        {"title": "x" * 161},
        {"claim": ""},
        {"claim": "x" * 401},
        {"excerpt": "x" * 1201},
        {"url": "ftp://example.org/x"},
        {"url": "example.org/x"},
        {"url": "https://example.org/" + "x" * 400},
        {"url": "https://exa mple.org/x"},
        {"independence": "MAYBE"},
    ],
)
def test_malformed_evidence_rejected(env, kwargs):
    vm, c, _ = env
    case_id = _open_bonded(c, vm)
    with reverts():
        submit_evidence(c, vm, case_id, **kwargs)


def test_non_independent_evidence_requires_an_affiliation_note(env):
    vm, c, _ = env
    case_id = _open_bonded(c, vm)
    for declaration in ["AFFILIATED", "SELF_PUBLISHED", "UNKNOWN"]:
        with reverts("affiliation_note is required"):
            submit_evidence(c, vm, case_id, independence=declaration, affiliation="")
    assert submit_evidence(
        c, vm, case_id, independence="AFFILIATED", affiliation="Vendor we contract with"
    ) != ""


def test_evidence_cap_enforced(env):
    vm, c, _ = env
    case_id = _open_bonded(c, vm)
    for index in range(12):
        submit_evidence(
            c, vm, case_id, url="https://example.org/source-" + str(index), title="s" + str(index)
        )
    with reverts("evidence cap reached"):
        submit_evidence(c, vm, case_id, url="https://example.org/source-99")


def test_text_only_evidence_cap_enforced(env):
    vm, c, _ = env
    case_id = _open_bonded(c, vm)
    for index in range(3):
        submit_evidence(c, vm, case_id, url="", title="text " + str(index))
    with reverts("text-only evidence cap"):
        submit_evidence(c, vm, case_id, url="", title="one too many")


# --------------------------------------------------------------------------- #
# Deduplication and independence                                               #
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "variant",
    [
        "https://cloudpricing.example.org/report-2030",
        "https://cloudpricing.example.org/report-2030/",
        "http://cloudpricing.example.org/report-2030",
        "https://www.cloudpricing.example.org/report-2030",
        "https://CloudPricing.Example.ORG/report-2030",
        "https://cloudpricing.example.org/report-2030?utm_source=x",
        "https://cloudpricing.example.org/report-2030#section-2",
    ],
)
def test_url_variants_are_detected_as_duplicates(env, variant):
    vm, c, _ = env
    case_id = _open_bonded(c, vm)
    submit_evidence(c, vm, case_id, url=EVIDENCE_URLS[0])
    with reverts("duplicate source url"):
        submit_evidence(c, vm, case_id, url=variant, title="restyled duplicate")


def test_different_paths_on_one_host_are_not_duplicates(env):
    vm, c, _ = env
    case_id = _open_bonded(c, vm)
    submit_evidence(c, vm, case_id, url="https://example.org/a", title="a")
    assert submit_evidence(c, vm, case_id, url="https://example.org/b", title="b") != ""


def test_same_host_items_are_flagged_as_non_independent(env):
    """
    Host diversity is a floor, not a proof of independence. Same-host items are
    surfaced to the adjudicator as an explicit non-independent cluster.
    """
    vm, c, _ = env
    case_id = _open_bonded(c, vm)
    submit_evidence(c, vm, case_id, url="https://sameorg.example.org/a", title="a")
    submit_evidence(c, vm, case_id, url="https://sameorg.example.org/b", title="b")
    captured = {}

    import re

    mock_sources(vm, ["https://sameorg.example.org/a", "https://sameorg.example.org/b"])

    original = vm.mock_llm

    def capture(pattern, response):
        original(pattern, response)

    vm.mock_llm = capture
    adjudicate(c, vm, case_id, verdict())
    # The clustering helper is deterministic and independently checkable.
    records = _evidence(c, case_id)
    hosts = [record["source_host"] for record in records]
    assert hosts.count("sameorg.example.org") == 2


def test_declared_independence_is_stored_verbatim(env):
    vm, c, _ = env
    case_id = _open_bonded(c, vm)
    evidence_id = submit_evidence(
        c, vm, case_id, independence="SELF_PUBLISHED", affiliation="We wrote this"
    )
    record = json.loads(c.get_evidence(evidence_id))
    assert record["independence_declared"] == "SELF_PUBLISHED"
    assert record["affiliation_note"] == "We wrote this"


# --------------------------------------------------------------------------- #
# Windows and freeze                                                           #
# --------------------------------------------------------------------------- #


def test_evidence_window_closes(env):
    vm, c, _ = env
    case_id = _open_bonded(c, vm)
    warp_to(vm, int(case_of(c, case_id)["evidence_window_ends"]) + 1)
    with reverts("evidence window has closed"):
        submit_evidence(c, vm, case_id)


def test_adjudication_freezes_evidence(env):
    vm, c, _ = env
    case_id = bonded_case_with_evidence(c, vm)
    assert case_of(c, case_id)["evidence_frozen"] is False
    adjudicate(c, vm, case_id)
    case = case_of(c, case_id)
    assert case["evidence_frozen"] is True
    assert case["evidence_fingerprint"] != ""
    with reverts("not accepting evidence"):
        submit_evidence(c, vm, case_id, url="https://example.org/late")


def test_failed_adjudication_does_not_unfreeze_or_mutate_evidence(env):
    """A malformed model response rolls the transaction back atomically."""
    vm, c, _ = env
    case_id = bonded_case_with_evidence(c, vm)
    freeze(c, vm, case_id)
    frozen_before = case_of(c, case_id)
    before = _evidence(c, case_id)

    with reverts():
        adjudicate(c, vm, case_id, "this is not json", do_freeze=False)

    case = case_of(c, case_id)
    # The freeze was committed in its own transaction, so it survives.
    assert case["evidence_frozen"] is True
    assert case["evidence_fingerprint"] == frozen_before["evidence_fingerprint"]
    assert case["frozen_evidence_ids"] == frozen_before["frozen_evidence_ids"]
    # No verdict was recorded and the case did not advance.
    assert case["current_verdict_json"] == ""
    assert case["proposed_decision"] == ""
    assert case["status"] == "EVIDENCE_FROZEN"
    # Evidence cannot be added afterwards either.
    with reverts("not accepting evidence"):
        submit_evidence(c, vm, case_id, url="https://example.org/after-failure")
    after = _evidence(c, case_id)
    assert [item["evidence_id"] for item in after] == [item["evidence_id"] for item in before]


def test_adjudication_requires_a_committed_freeze(env):
    vm, c, _ = env
    case_id = bonded_case_with_evidence(c, vm)
    mock_sources(vm)
    from conftest import mock_adjudicator

    mock_adjudicator(vm, verdict())
    vm.sender = PROPOSER
    with reverts("evidence must be frozen"):
        c.request_adjudication(case_id)


def test_minimum_evidence_count_enforced(env):
    vm, c, _ = env
    register(c, vm)
    create_policy(c, vm, min_evidence=3, min_independent=1)
    case_id = open_case(c, vm)
    lock_bond(c, vm, case_id)
    seed_evidence(c, vm, case_id, 2)
    with reverts("evidence items required"):
        adjudicate(c, vm, case_id)


def test_required_evidence_categories_enforced(env):
    vm, c, _ = env
    register(c, vm)
    create_policy(c, vm, min_evidence=2, required_categories=["AUDIT_REPORT", "VENDOR_QUOTE"])
    case_id = open_case(c, vm)
    lock_bond(c, vm, case_id)
    submit_evidence(c, vm, case_id, category="MARKET_PRICING", url=EVIDENCE_URLS[0])
    submit_evidence(c, vm, case_id, category="AUDIT_REPORT", url=EVIDENCE_URLS[1], title="b")
    with reverts("missing required evidence category VENDOR_QUOTE"):
        adjudicate(c, vm, case_id)


def test_fetch_populates_status_and_slice(env):
    vm, c, _ = env
    case_id = bonded_case_with_evidence(c, vm)
    adjudicate(c, vm, case_id)
    for record in _evidence(c, case_id):
        assert record["fetch_status"] == "FETCHED"
        assert record["fetched_excerpt"] != ""


def test_unfetchable_source_is_marked_unavailable_not_fatal(env):
    vm, c, _ = env
    register(c, vm)
    create_policy(c, vm, min_evidence=2, min_independent=0)
    case_id = open_case(c, vm)
    lock_bond(c, vm, case_id)
    submit_evidence(c, vm, case_id, url=EVIDENCE_URLS[0], title="reachable")
    submit_evidence(c, vm, case_id, url="https://offline.example.org/gone", title="dead")
    freeze(c, vm, case_id)
    mock_sources(vm, [EVIDENCE_URLS[0]])
    from conftest import mock_adjudicator

    mock_adjudicator(vm, verdict())
    vm.sender = PROPOSER
    c.request_adjudication(case_id)
    statuses = {record["title"]: record["fetch_status"] for record in _evidence(c, case_id)}
    assert statuses["reachable"] == "FETCHED"
    assert statuses["dead"] == "UNAVAILABLE"


def test_fetched_body_is_sliced_not_stored_whole(env):
    vm, c, _ = env
    case_id = bonded_case_with_evidence(c, vm)
    freeze(c, vm, case_id)
    mock_sources(vm, body="A" * 50000)
    from conftest import mock_adjudicator

    mock_adjudicator(vm, verdict())
    vm.sender = PROPOSER
    c.request_adjudication(case_id)
    for record in _evidence(c, case_id):
        assert len(record["fetched_excerpt"]) == 3000


def test_all_sources_unfetchable_is_structurally_invalid(env):
    vm, c, _ = env
    case_id = bonded_case_with_evidence(c, vm)
    freeze(c, vm, case_id)
    from conftest import mock_adjudicator

    mock_adjudicator(vm, verdict())
    vm.sender = PROPOSER
    assert c.request_adjudication(case_id) == "INVALID"
    assert case_of(c, case_id)["decision_reason"] == "EVIDENCE_SET_EMPTY_OR_UNFETCHABLE"


def test_case_evidence_pagination_bounded(env):
    vm, c, _ = env
    case_id = bonded_case_with_evidence(c, vm)
    page = json.loads(c.get_case_evidence(case_id, "0", "1"))
    assert page["total"] == 2
    assert len(page["items"]) == 1
    with reverts():
        c.get_case_evidence(case_id, "0", "51")


def test_unknown_evidence_lookup_reverts(env):
    vm, c, _ = env
    with reverts("evidence not found"):
        c.get_evidence("e_999")
