# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
#
# NON-PRODUCTION NATIVE GEN CAPABILITY PROBE - REFUND PATH.
# NOT Treasury Trial production code. Do not deploy without approval.
#
# rev 5. This is bisect contract T11 verbatim except for the class name.
# T11 loaded its schema and deployed successfully in the user Studio at
# 0x72...891c on 2026-08-27. Do not add anything to this file.
#
# Constraints learned from the T1-T13 bisect:
#   - ASCII only, including comments.
#   - plain "def __init__(self):" with no return annotation.
#   - no private helper methods on the contract class.
#   - Adding the slash path (mark_slashable + execute_slash, which brings a
#     SECOND emit_transfer call site) made the schema fail to load. Which of
#     the two methods is at fault is not yet isolated, so the slash path
#     lives in its own probe file. Every contract that has loaded so far has
#     at most one emit_transfer call site.

from genlayer import *

import json


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass
    class Write:
        pass


class GenRoundtripProbe(gl.Contract):
    deposits: TreeMap[str, str]
    statuses: TreeMap[str, str]
    owner: str
    total_received: u256
    total_paid_out: u256

    def __init__(self):
        self.owner = gl.message.sender_address.as_hex
        self.total_received = u256(0)
        self.total_paid_out = u256(0)

    @gl.public.write.payable
    def deposit(self) -> str:
        amount = int(gl.message.value)
        if amount <= 0:
            raise gl.vm.UserError("EXPECTED: must send a positive native GEN value")
        sender = gl.message.sender_address.as_hex
        if sender in self.deposits:
            raise gl.vm.UserError("EXPECTED: deposit already exists for sender")
        self.deposits[sender] = str(amount)
        self.statuses[sender] = "LOCKED"
        self.total_received = u256(int(self.total_received) + amount)
        return str(amount)

    @gl.public.write
    def mark_refundable(self, depositor: str) -> str:
        if gl.message.sender_address.as_hex != self.owner:
            raise gl.vm.UserError("EXPECTED: only owner")
        if depositor not in self.deposits:
            raise gl.vm.UserError("EXPECTED: no deposit for that address")
        if self.statuses[depositor] != "LOCKED":
            raise gl.vm.UserError("EXPECTED: deposit not LOCKED")
        self.statuses[depositor] = "REFUNDABLE"
        return "REFUNDABLE"

    @gl.public.write
    def claim_refund(self) -> str:
        sender = gl.message.sender_address.as_hex
        if sender not in self.deposits:
            raise gl.vm.UserError("EXPECTED: no deposit for sender")
        if self.statuses[sender] != "REFUNDABLE":
            raise gl.vm.UserError("EXPECTED: deposit not REFUNDABLE")
        amount = int(self.deposits[sender])
        self.statuses[sender] = "REFUNDED"
        self.total_paid_out = u256(int(self.total_paid_out) + amount)
        _Recipient(Address(sender)).emit_transfer(value=u256(amount))
        return str(amount)

    @gl.public.view
    def get_amount(self, depositor: str) -> str:
        return self.deposits[depositor] if depositor in self.deposits else "0"

    @gl.public.view
    def get_status(self, depositor: str) -> str:
        return self.statuses[depositor] if depositor in self.statuses else "NONE"

    @gl.public.view
    def get_totals(self) -> str:
        return json.dumps({"owner": self.owner, "total_received": int(self.total_received), "total_paid_out": int(self.total_paid_out)})
