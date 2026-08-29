"""
Static guards on the production contract source.

These encode the Studio schema-load constraints established empirically in
Stage 1 (Addendum B.0). They are cheap, they run without a VM, and they catch
the exact mistakes that cost a full debugging cycle:

  * a single non-ASCII byte anywhere - including in a comment - makes
    gen_getContractSchemaForCode fail with VM_ERROR invalid_contract;
  * `def __init__(self) -> None:` breaks schema extraction;
  * separate refund and slash methods failed to load, so payout must stay a
    single parameterized method.
"""

import ast
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PRODUCTION = ROOT / "contracts" / "treasury_trial.py"
PROBES = sorted((ROOT / "contracts" / "capability_test").glob("*.py"))
ALL_CONTRACTS = [PRODUCTION] + PROBES

RUNNER_PIN = "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6"


def _source(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _tree(path: Path) -> ast.Module:
    return ast.parse(_source(path))


def _contract_class(path: Path) -> ast.ClassDef:
    for node in _tree(path).body:
        if isinstance(node, ast.ClassDef):
            for base in node.bases:
                if isinstance(base, ast.Attribute) and base.attr == "Contract":
                    return node
    raise AssertionError("no gl.Contract subclass found in " + str(path))


# --------------------------------------------------------------------------- #
# Rule 1: pure ASCII                                                           #
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("path", ALL_CONTRACTS, ids=lambda p: p.name)
def test_contract_source_is_pure_ascii(path):
    raw = path.read_bytes()
    offenders = [(index, hex(byte)) for index, byte in enumerate(raw) if byte > 127]
    assert offenders == [], (
        "Non-ASCII bytes in " + path.name + " at " + str(offenders[:5]) + ". "
        "GenLayer Studio fails schema extraction with VM_ERROR invalid_contract "
        "when any non-ASCII byte is present, comments included."
    )


@pytest.mark.parametrize("path", ALL_CONTRACTS, ids=lambda p: p.name)
def test_contract_source_has_no_crlf_or_bom(path):
    raw = path.read_bytes()
    assert not raw.startswith(b"\xef\xbb\xbf"), "UTF-8 BOM in " + path.name
    assert b"\r\n" not in raw, "CRLF line endings in " + path.name


@pytest.mark.parametrize("path", ALL_CONTRACTS, ids=lambda p: p.name)
def test_no_typographic_characters_slip_in(path):
    """Belt and braces: the specific characters that broke earlier revisions."""
    text = _source(path)
    for char, name in [
        ("—", "em dash"),
        ("–", "en dash"),
        ("§", "section sign"),
        ("‘", "left single quote"),
        ("’", "right single quote"),
        ("“", "left double quote"),
        ("”", "right double quote"),
        ("→", "arrow"),
        (" ", "non-breaking space"),
    ]:
        assert char not in text, name + " found in " + path.name


# --------------------------------------------------------------------------- #
# Rule 2: Studio-compatible contract shape                                     #
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("path", ALL_CONTRACTS, ids=lambda p: p.name)
def test_init_has_no_return_annotation(path):
    for node in ast.walk(_tree(path)):
        if isinstance(node, ast.FunctionDef) and node.name == "__init__":
            assert node.returns is None, (
                "`def __init__(self) -> None:` breaks Studio schema extraction; "
                "use a plain `def __init__(self):` in " + path.name
            )


@pytest.mark.parametrize("path", ALL_CONTRACTS, ids=lambda p: p.name)
def test_runner_pin_header_present(path):
    lines = _source(path).splitlines()
    assert re.match(r"^# v\d+\.\d+\.\d+$", lines[0]), (
        "first line must be a plain contract version tag in " + path.name
    )
    assert RUNNER_PIN in lines[1], "second line must pin the verified runner in " + path.name


def test_production_contract_parses():
    assert _contract_class(PRODUCTION).name == "TreasuryTrial"


# --------------------------------------------------------------------------- #
# Rule 3: one parameterized payout method                                      #
# --------------------------------------------------------------------------- #


def _public_methods(path):
    methods = {}
    for node in _contract_class(path).body:
        if not isinstance(node, ast.FunctionDef):
            continue
        for decorator in node.decorator_list:
            text = ast.unparse(decorator)
            if text.startswith("gl.public"):
                methods[node.name] = text
    return methods


def test_exactly_one_emit_transfer_call_site():
    """
    Stage 1: a contract carrying separate refund and slash payout methods
    failed to load its schema, while the same logic behind one parameterized
    method loaded and worked on StudioNet.
    """
    source = _source(PRODUCTION)
    assert source.count("emit_transfer") == 1


def test_no_separate_refund_and_slash_methods():
    methods = _public_methods(PRODUCTION)
    assert "execute_payout" in methods
    for forbidden in ["claim_refund", "execute_slash", "refund", "slash", "payout_to"]:
        assert forbidden not in methods


def test_payout_takes_only_a_case_id():
    """No caller may choose a recipient."""
    for node in _contract_class(PRODUCTION).body:
        if isinstance(node, ast.FunctionDef) and node.name == "execute_payout":
            names = [arg.arg for arg in node.args.args]
            assert names == ["self", "case_id"]
            return
    raise AssertionError("execute_payout not found")


def test_payable_surface_is_only_the_bond():
    payable = [
        name for name, decorator in _public_methods(PRODUCTION).items() if "payable" in decorator
    ]
    assert payable == ["lock_bond"]


def test_lock_bond_takes_no_amount_argument():
    """The bond must derive from gl.message.value, never a declared number."""
    for node in _contract_class(PRODUCTION).body:
        if isinstance(node, ast.FunctionDef) and node.name == "lock_bond":
            assert [arg.arg for arg in node.args.args] == ["self", "case_id"]
            return
    raise AssertionError("lock_bond not found")


# --------------------------------------------------------------------------- #
# Rule 4: no admin backdoors in the public surface                             #
# --------------------------------------------------------------------------- #


def test_owner_surface_is_pause_only():
    """The only methods gated on ownership are pause and unpause."""
    owner_gated = []
    for node in _contract_class(PRODUCTION).body:
        if not isinstance(node, ast.FunctionDef):
            continue
        if node.name == "_require_owner":
            continue
        if "self._require_owner()" in ast.unparse(node):
            owner_gated.append(node.name)
    assert sorted(owner_gated) == ["pause", "unpause"]


def test_no_public_method_writes_an_arbitrary_address():
    """
    Every Address(...) used for a transfer must come from frozen case state.
    """
    source = _source(PRODUCTION)
    assert "Address(recipient)" in source
    assert "Address(gl.message" not in source
    for suspicious in ["Address(to)", "Address(target)", "Address(destination)"]:
        assert suspicious not in source


def test_no_full_page_bodies_persisted():
    source = _source(PRODUCTION)
    assert "[:FETCH_SLICE]" in source
    assert "FETCH_SLICE = 3000" in source


def test_deterministic_decide_is_module_level_and_pure():
    """The authoritative decision function must not touch storage."""
    for node in _tree(PRODUCTION).body:
        if isinstance(node, ast.FunctionDef) and node.name == "_decide":
            body = ast.unparse(node)
            assert "self." not in body
            return
    raise AssertionError("_decide not found")


def test_init_is_the_only_dunder_method():
    """
    No dunder other than __init__ on the contract class.

    An earlier revision carried an `__on_errored_message__` hook to reopen
    failed payouts. Studio could not extract the contract schema with it
    present, and no contract in this codebase that loads carries any dunder
    besides __init__ - Foresign, Continuum and SeedWager all agree. Removing
    it was what made the production contract deployable.
    """
    dunders = [
        node.name
        for node in _contract_class(PRODUCTION).body
        if isinstance(node, ast.FunctionDef) and node.name.startswith("__")
    ]
    assert dunders == ["__init__"]


def test_only_str_annotations_are_used():
    """
    Match the annotation vocabulary of the contracts that actually deploy.

    Foresign, which deploys, annotates method parameters and returns with
    `str` or not at all - never `bool`, `int` or anything else. Treasury Trial
    originally used one `bool` parameter and one `-> int` return; both were
    removed while making the contract loadable, and both are kept out here.
    """
    allowed = {"str", None}
    for node in _contract_class(PRODUCTION).body:
        if not isinstance(node, ast.FunctionDef):
            continue
        returns = ast.unparse(node.returns) if node.returns else None
        assert returns in allowed, node.name + " returns " + str(returns)
        for arg in node.args.args[1:]:
            annotation = ast.unparse(arg.annotation) if arg.annotation else None
            assert annotation in allowed, node.name + " takes " + str(annotation)


def test_no_docstrings_on_public_methods():
    """
    Public methods must carry no docstring.

    Across the user's four contracts that deploy - Foresign, Continuum,
    SeedWager and Seedling - there are 138 `@gl.public.*` methods and ZERO
    docstrings on any of them. Treasury Trial had 14, the largest 1339
    characters, and Studio could not extract its schema. Docstrings on module
    functions and private methods are fine and are used by those contracts;
    it is specifically the decorated public surface that must stay clear.

    The content was not deleted - it was moved to `#` comments above each
    decorator.
    """
    offenders = []
    for node in _contract_class(PRODUCTION).body:
        if not isinstance(node, ast.FunctionDef):
            continue
        if not any(ast.unparse(d).startswith("gl.public") for d in node.decorator_list):
            continue
        if ast.get_docstring(node):
            offenders.append(node.name)
    assert offenders == [], "docstring on public method(s): " + ", ".join(offenders)
