# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
#
# NATIVE GEN CAPABILITY TEST CONTRACT — NOT PART OF FORESIGN.
#
# This exists only to answer one Stage 4 question with a real, independently
# checkable StudioNet round-trip: does the already-observed
# `@gl.public.write.payable` + `gl.message.value` + `gl.evm.contract_interface`
# + `emit_transfer` pattern (verified deployed in this user's Continuum
# Protocol contract) actually deliver native GEN deposit -> contract custody
# -> recipient payout on StudioNet?
#
# This is a capability probe, never a FORESIGN production contract. Do not
# deploy this alongside FORESIGN, do not reference its address from FORESIGN,
# and do not copy its refund() method into FORESIGN's ABI — FORESIGN Stage 4
# explicitly forbids any withdrawal method before finalization (see Stage 4
# report §14). Archive or delete this file once the capability question is
# answered.
#
# Procedure (run manually — see test/native_gen_capability/README.md):
#   1. deploy this contract
#   2. call deposit() as account A, attaching a native GEN value
#   3. call get_deposit(A) and get_totals() — confirm the recorded amount
#      exactly matches what was sent (not more, not less)
#   4. call refund(B, amount) to send that value on to a second account B
#   5. independently check B's on-chain balance increased by exactly `amount`
#
# If steps 3 and 5 both hold, the pattern is verified end-to-end and Stage 4
# can report NATIVE_GEN_VERIFIED. If either step fails, is unreachable, or
# behaves ambiguously, Stage 4 must report NATIVE_GEN_NOT_VERIFIED and
# FORESIGN stays on ACCOUNTING_ONLY.

from genlayer import *

import json


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass
    class Write:
        pass


class NativeGenCapabilityTest(gl.Contract):
    deposits: TreeMap[str, str]  # depositor_hex -> cumulative amount (str)
    total_received: u256
    total_refunded: u256

    def __init__(self):
        self.total_received = u256(0)
        self.total_refunded = u256(0)

    @gl.public.write.payable
    def deposit(self) -> str:
        amount = int(gl.message.value)
        if amount <= 0:
            raise gl.vm.UserError("EXPECTED: must send a positive native GEN value")

        sender = gl.message.sender_address.as_hex
        existing = int(self.deposits[sender]) if sender in self.deposits else 0
        self.deposits[sender] = str(existing + amount)
        self.total_received = u256(int(self.total_received) + amount)
        return str(amount)

    @gl.public.write
    def refund(self, recipient: str, amount: str) -> str:
        # Test-only convenience with no production meaning: this contract
        # holds nothing but funds testers themselves deposited, so an
        # unrestricted refund-to-address is acceptable here and MUST NOT be
        # copied into FORESIGN, where no withdrawal path may exist before
        # finalization (Stage 4 §13).
        amt = int(amount)
        if amt <= 0:
            raise gl.vm.UserError("EXPECTED: amount must be positive")
        _Recipient(Address(recipient)).emit_transfer(value=u256(amt))
        self.total_refunded = u256(int(self.total_refunded) + amt)
        return amount

    @gl.public.view
    def get_deposit(self, address: str) -> str:
        return self.deposits[address] if address in self.deposits else "0"

    @gl.public.view
    def get_totals(self) -> str:
        return json.dumps({
            "total_received": int(self.total_received),
            "total_refunded": int(self.total_refunded),
        })
