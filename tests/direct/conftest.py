"""
Shared fixtures and builders for Treasury Trial direct-mode tests.

Every test gets a fresh VM (fresh in-memory storage) and a freshly deployed
`TreasuryTrial` via the `env` fixture. The VM clock is warped to a fixed anchor
(`BASE`) so lifecycle windows are deterministic.

Nondeterminism is mocked, never live:
  * `vm.mock_web`  supplies frozen page text for `gl.get_webpage`
  * `vm.mock_llm`  supplies the adjudicator's JSON for `gl.nondet.exec_prompt`

Outbound native GEN
-------------------
The direct runner does NOT move balances for `emit_transfer`; it surfaces the
emitted message to `vm._gl_call_hook` as an `EthSend` request. We install a
capture hook so tests can assert the exact recipient and amount of every
outbound transfer, and can simulate a FAILED transfer. Real value movement was
verified separately on live StudioNet (Stage 1 section 16) and is covered by
the manual checklist in `docs/STUDIONET_LIVE_BOND_CHECKLIST.md`.
"""

import datetime as _dt
import hashlib
import json
from pathlib import Path

import pytest
from gltest.direct import VMContext, deploy_contract

CONTRACT_PATH = str(Path(__file__).resolve().parents[2] / "contracts" / "treasury_trial.py")


# --------------------------------------------------------------------------- #
# Addresses. `vm.sender` takes raw bytes; the contract stores the runtime's    #
# EIP-55 checksummed form, so always compare through `checksum()`.             #
# --------------------------------------------------------------------------- #


def addr_bytes(seed: str) -> bytes:
    return hashlib.sha256(seed.encode()).digest()[:20]


def addr_hex(seed: str) -> str:
    return "0x" + addr_bytes(seed).hex()


def checksum(raw: str) -> str:
    from genlayer import Address

    return Address(raw).as_hex


OWNER = addr_bytes("tt-owner")
CONTROLLER = addr_bytes("tt-controller")
PROPOSER = addr_bytes("tt-proposer")
CHALLENGER = addr_bytes("tt-challenger")
OUTSIDER = addr_bytes("tt-outsider")
TREASURY = addr_bytes("tt-treasury")

OWNER_HEX = addr_hex("tt-owner")
CONTROLLER_HEX = addr_hex("tt-controller")
PROPOSER_HEX = addr_hex("tt-proposer")
CHALLENGER_HEX = addr_hex("tt-challenger")
TREASURY_HEX = addr_hex("tt-treasury")


# --------------------------------------------------------------------------- #
# Clock                                                                        #
# --------------------------------------------------------------------------- #

BASE = 1893456000  # 2030-01-01T00:00:00Z
HOUR = 3600
DAY = 86400

DEFAULT_EVIDENCE_WINDOW = 7 * DAY
DEFAULT_CHALLENGE_WINDOW = 3 * DAY
BOND = 10 ** 18  # 1 GEN


def warp_to(vm, epoch: int) -> None:
    iso = (
        _dt.datetime.fromtimestamp(int(epoch), tz=_dt.timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )
    vm.warp(iso)


# --------------------------------------------------------------------------- #
# Outbound transfer capture                                                    #
# --------------------------------------------------------------------------- #


class Transfers:
    """Records every EthSend the contract emits; can be armed to fail."""

    def __init__(self):
        self.sent = []
        self.fail_next = False

    def install(self, vm):
        def hook(_vm, request):
            if "EthSend" in request:
                data = request["EthSend"]
                self.sent.append(
                    {"address": str(data.get("address")), "value": int(data.get("value", 0))}
                )
                if self.fail_next:
                    self.fail_next = False
                    raise RuntimeError("simulated outbound transfer failure")
                return {"ok": None}
            return None

        vm._gl_call_hook = hook

    def last(self):
        return self.sent[-1]

    def recipient_matches(self, expected_hex: str) -> bool:
        return checksum(expected_hex).lower() in self.last()["address"].lower()


# --------------------------------------------------------------------------- #
# Model output builders                                                        #
# --------------------------------------------------------------------------- #

DIMENSIONS = [
    "MATERIAL_CHANGE_CONFIRMED",
    "POLICY_PURPOSE_CONSISTENT",
    "PROPORTIONAL_TO_NEED",
    "EVIDENCE_SUFFICIENT",
    "SOURCE_INDEPENDENCE",
    "REASONABLE_ALTERNATIVES_CONSIDERED",
    "CONFLICT_OF_INTEREST_CLEAR",
    "MANIPULATION_RISK_ACCEPTABLE",
]

PROMPT_PATTERN = r"You are an adjudicator for a DAO treasury policy amendment"


def verdict(
    outcome: str = "ACCEPT",
    results=None,
    invalid_reason: str = "",
    numeric_support: str = "STRONG",
    decisive=None,
    unverified=None,
    signals=None,
    short_reason: str = "Evidence supports the amendment under the frozen policy.",
    extra=None,
    drop=None,
) -> dict:
    """A well-formed model verdict, with hooks for building malformed ones."""
    results = results or {}
    body = {
        "outcome": outcome,
        "invalid_reason": invalid_reason,
        "numeric_support": numeric_support,
        "dimensions": {
            name: {"result": results.get(name, "PASS"), "reason": "ok"} for name in DIMENSIONS
        },
        "decisive_evidence_ids": decisive if decisive is not None else [],
        "unverified_evidence_ids": unverified if unverified is not None else [],
        "manipulation_signals": signals if signals is not None else [],
        "short_reason": short_reason,
    }
    if extra:
        body.update(extra)
    for key in drop or []:
        body.pop(key, None)
    return body


def mock_adjudicator(vm, result) -> None:
    payload = result if isinstance(result, str) else json.dumps(result)
    vm.mock_llm(PROMPT_PATTERN, payload)


EVIDENCE_URLS = [
    "https://cloudpricing.example.org/report-2030",
    "https://auditfirm.example.net/incident-brief",
    "https://vendor.example.com/quote-4471",
    "https://gov.example.gov/filing/8812",
]


def mock_sources(vm, urls=None, body: str = "Infrastructure and audit costs rose materially in 2030.") -> None:
    import re

    for url in urls if urls is not None else EVIDENCE_URLS:
        vm.mock_web(r"^" + re.escape(url) + r"$", {"status": 200, "body": body})


# --------------------------------------------------------------------------- #
# Protocol builders                                                            #
# --------------------------------------------------------------------------- #

DAO_ID = "example-dao"


def register(c, vm, dao_id: str = DAO_ID, sender: bytes = CONTROLLER) -> str:
    vm.sender = sender
    return c.register_dao(dao_id)


def create_policy(
    c,
    vm,
    dao_id: str = DAO_ID,
    sender: bytes = CONTROLLER,
    treasury: str = TREASURY_HEX,
    title: str = "Treasury Policy",
    description: str = "Funds developer grants, infrastructure, security and community events.",
    categories=None,
    max_allocation: int = 50000,
    currency: str = "USD",
    bond: int = BOND,
    criteria=None,
    required_categories=None,
    min_evidence: int = 2,
    min_independent: int = 1,
    challenge_window: int = DEFAULT_CHALLENGE_WINDOW,
    evidence_window: int = DEFAULT_EVIDENCE_WINDOW,
) -> str:
    vm.sender = sender
    return c.create_policy(
        dao_id,
        treasury,
        title,
        description,
        json.dumps(
            categories
            if categories is not None
            else ["developer grants", "infrastructure", "security", "community events"]
        ),
        str(max_allocation),
        currency,
        str(bond),
        json.dumps(criteria if criteria is not None else list(DIMENSIONS)),
        json.dumps(required_categories if required_categories is not None else []),
        str(min_evidence),
        str(min_independent),
        str(challenge_window),
        str(evidence_window),
    )


def open_case(
    c,
    vm,
    dao_id: str = DAO_ID,
    sender: bytes = PROPOSER,
    field: str = "maximum_individual_allocation",
    proposed: str = "80000",
    rationale: str = "Security infrastructure costs have materially increased since v1.",
) -> str:
    vm.sender = sender
    return c.open_amendment_case(dao_id, field, proposed, rationale)


def lock_bond(c, vm, case_id: str, sender: bytes = PROPOSER, amount: int = None) -> str:
    """Lock the bond. Defaults to exactly the amount frozen into the case."""
    if amount is None:
        amount = int(json.loads(c.get_case(case_id))["bond_amount"])
    vm.sender = sender
    vm.value = amount
    try:
        return c.lock_bond(case_id)
    finally:
        vm.value = 0


def submit_evidence(
    c,
    vm,
    case_id: str,
    sender: bytes = PROPOSER,
    category: str = "MARKET_PRICING",
    title: str = "Cloud infrastructure pricing report 2030",
    url: str = EVIDENCE_URLS[0],
    excerpt: str = "Managed audit and infrastructure pricing rose 58 percent year over year.",
    claim: str = "Infrastructure and audit costs rose materially since the policy was written.",
    independence: str = "INDEPENDENT",
    affiliation: str = "",
) -> str:
    vm.sender = sender
    return c.submit_evidence(
        case_id, category, title, url, excerpt, claim, independence, affiliation
    )


def seed_evidence(c, vm, case_id: str, count: int = 2) -> list:
    """Submit `count` distinct, independent, mockable evidence items."""
    ids = []
    categories = ["MARKET_PRICING", "AUDIT_REPORT", "VENDOR_QUOTE", "GOVERNANCE_RECORD"]
    for index in range(count):
        ids.append(
            submit_evidence(
                c,
                vm,
                case_id,
                category=categories[index % len(categories)],
                title="Source " + str(index + 1),
                url=EVIDENCE_URLS[index % len(EVIDENCE_URLS)],
            )
        )
    return ids


def bonded_case_with_evidence(c, vm, *, setup=True, policy=None, case=None, evidence_count=2):
    """
    register -> policy -> case -> bond -> evidence. Returns the case id.

    Pass `setup=False` to open a further case against an already-registered DAO
    that already has a policy (for example after an earlier amendment landed).
    """
    if setup:
        register(c, vm)
        create_policy(c, vm, **(policy or {}))
    case_id = open_case(c, vm, **(case or {}))
    lock_bond(c, vm, case_id)
    seed_evidence(c, vm, case_id, evidence_count)
    return case_id


def freeze(c, vm, case_id: str, sender: bytes = PROPOSER) -> str:
    vm.sender = sender
    return c.freeze_evidence(case_id)


def adjudicate(c, vm, case_id: str, result=None, sender: bytes = PROPOSER, do_freeze=True) -> str:
    """Freeze (unless already frozen), mock the sources and the model, adjudicate."""
    if do_freeze and case_of(c, case_id)["status"] == "EVIDENCE_OPEN":
        freeze(c, vm, case_id, sender=sender)
    mock_sources(vm)
    mock_adjudicator(vm, result if result is not None else verdict())
    vm.sender = sender
    return c.request_adjudication(case_id)


def finalize(c, vm, case_id: str, sender: bytes = OUTSIDER) -> str:
    case = json.loads(c.get_case(case_id))
    warp_to(vm, int(case["challenge_window_ends"]) + 1)
    vm.sender = sender
    return c.finalize_case(case_id)


def contract_module(c):
    """
    The loaded contract module, for unit-testing its pure helpers directly.

    Needed where the gltest harness cannot reproduce a condition end to end -
    notably the model-output size cap, because the LLM mock re-serializes any
    JSON response compactly and so cannot deliver an oversized document.
    """
    import sys

    return sys.modules[type(c).__module__]


def reverts(fragment: str = ""):
    """Assert the contract rejects an action, optionally matching the reason."""
    import re

    return pytest.raises(Exception, match=re.escape(fragment) if fragment else None)


def case_of(c, case_id: str) -> dict:
    return json.loads(c.get_case(case_id))


def bond_of(c, case_id: str) -> dict:
    return json.loads(c.get_bond_state(case_id))


def policy_of(c, policy_id: str) -> dict:
    return json.loads(c.get_policy(policy_id))


def current_policy(c, dao_id: str = DAO_ID) -> dict:
    return json.loads(c.get_current_policy(dao_id))


# --------------------------------------------------------------------------- #
# Fixtures                                                                     #
# --------------------------------------------------------------------------- #


def _install_get_webpage_shim(vm) -> None:
    """
    Provide `gl.get_webpage` for direct-mode tests.

    RUNTIME DIVERGENCE, recorded deliberately: the local gltest direct runner
    extracts py-lib-genlayer-std v0.3.0-rc7, which exposes `gl.nondet.web` and
    has NO `gl.get_webpage`. The pinned Studio runtime
    (py-genlayer:1jb45aa8..., GenVM v0.2.16) DOES expose `gl.get_webpage` - it
    is used by the user's deployed Contradiction Protocol contract, which is
    the verification basis recorded in Stage 1 section 1.2.

    Production code therefore keeps `gl.get_webpage`, the API verified against
    the deployment target, and the harness supplies it locally rather than the
    contract switching to an API this project has never verified. The shim
    reads the SAME mock registry that `vm.mock_web` populates, so tests
    exercise the contract's real fetch, slice and failure-handling path.
    """
    import genlayer

    def get_webpage(url, mode="text"):
        mock = vm._match_web_mock(url, "GET")
        if not mock:
            raise RuntimeError("no web mock registered for " + str(url))
        if int(mock.get("status", 200)) >= 400:
            raise RuntimeError("http status " + str(mock.get("status")))
        body = mock.get("body", "")
        if isinstance(body, bytes):
            body = body.decode("utf-8", "replace")
        return body

    genlayer.gl.get_webpage = get_webpage


@pytest.fixture
def env():
    """Fresh VM + deployed TreasuryTrial, clock at BASE, transfer capture armed."""
    vm = VMContext()
    vm.sender = OWNER
    transfers = Transfers()
    transfers.install(vm)
    with vm.activate():
        contract = deploy_contract(CONTRACT_PATH, vm)
        _install_get_webpage_shim(vm)
        warp_to(vm, BASE)
        for account in (OWNER, CONTROLLER, PROPOSER, CHALLENGER, OUTSIDER, TREASURY):
            vm.deal(account, 100 * BOND)
        yield vm, contract, transfers
