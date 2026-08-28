# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
#
# NON-PRODUCTION NATIVE GEN CAPABILITY PROBE - SLASH PATH.
# NOT Treasury Trial production code. Do not deploy without approval.
#
# Separate from gen_roundtrip_probe.py on purpose: putting both the refund
# path and the slash path in one contract made Studio fail to load the
# schema. This file is gen_roundtrip_probe.py with mark_refundable renamed
# to mark_slashable and claim_refund replaced by execute_slash, so it still
# has exactly ONE emit_transfer call site.
#
# Optional. Only run this after the refund probe has passed. It answers one
# extra question: can the contract pay out to a THIRD PARTY address (the DAO
# treasury) rather than back to the depositor?
#
# Constraints: ASCII only including comments; plain "def __init__(self):";
# no private helper methods.

from genlayer import *

import json


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass
    class Write:
        pass


class GenSlashProbe(gl.Contract):
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
    def mark_slashable(self, depositor: str) -> str:
        if gl.message.sender_address.as_hex != self.owner:
            raise gl.vm.UserError("EXPECTED: only owner")
        if depositor not in self.deposits:
            raise gl.vm.UserError("EXPECTED: no deposit for that address")
        if self.statuses[depositor] != "LOCKED":
            raise gl.vm.UserError("EXPECTED: deposit not LOCKED")
        self.statuses[depositor] = "SLASHABLE"
        return "SLASHABLE"

    @gl.public.write
    def execute_slash(self, depositor: str, treasury: str) -> str:
        if depositor not in self.deposits:
            raise gl.vm.UserError("EXPECTED: no deposit for that address")
        if self.statuses[depositor] != "SLASHABLE":
            raise gl.vm.UserError("EXPECTED: deposit not SLASHABLE")
        amount = int(self.deposits[depositor])
        self.statuses[depositor] = "SLASHED"
        self.total_paid_out = u256(int(self.total_paid_out) + amount)
        _Recipient(Address(treasury)).emit_transfer(value=u256(amount))
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
