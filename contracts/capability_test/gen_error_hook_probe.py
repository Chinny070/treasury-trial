# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *

import json


# NON-PRODUCTION CAPABILITY PROBE - failed outbound transfer recovery.
# NOT Treasury Trial production code. Do not deploy as production.
#
# Answers Stage 1 open item G with live evidence:
#   1. does a failed outbound transfer reliably invoke __on_errored_message__
#   2. what context the callback has
#   3. whether it can deterministically associate a failure with a payout
#   4. whether it fires ONLY for genuine failures
#   5. whether it can restore PAYOUT_PENDING to a retryable state
#   6. whether a completed payout is protected from being reopened
#   7. whether a retry can ever double-pay
#   8. whether the 3600s confirmation delay is still needed
#
# Source shape follows the rules established in Stage 2: leading comment block
# is 2 lines; pure ASCII; LF; plain __init__; no docstrings on public methods;
# str-or-nothing annotations; all commentary below the imports; one
# emit_transfer call site.
#
# The callback takes NO parameters, so association with a specific payout can
# only come from contract storage written before the transfer is emitted. That
# single-slot in-flight pointer is exactly the production mechanism under test.
#
# hook_calls increments on EVERY invocation, before any guard returns, so the
# probe can distinguish "callback never fired" from "callback fired but
# correctly declined to act".
#
# Deliberate failure is produced by overdraft: emitting a multiple of the
# deposited amount that the contract cannot possibly hold. That is safe and
# deterministic - no GEN can be lost because the transfer cannot succeed - and
# it does not depend on how a recipient contract behaves.


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass
    class Write:
        pass


class GenErrorHookProbe(gl.Contract):
    config: TreeMap[str, str]
    deposits: TreeMap[str, str]
    statuses: TreeMap[str, str]
    recipients: TreeMap[str, str]
    failures: TreeMap[str, str]
    hook_calls: u256
    total_received: u256
    total_emitted: u256

    def __init__(self):
        self.config["owner"] = gl.message.sender_address.as_hex
        self.config["in_flight"] = ""
        self.config["last_hook_target"] = ""
        self.config["last_hook_status"] = ""
        self.hook_calls = u256(0)
        self.total_received = u256(0)
        self.total_emitted = u256(0)

    # Deposit native GEN. Amount comes from gl.message.value only.
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
        self.failures[sender] = "0"
        self.total_received = u256(int(self.total_received) + amount)
        return str(amount)

    # Owner marks a deposit ready for payout and freezes the recipient.
    @gl.public.write
    def prepare_payout(self, depositor: str, recipient: str) -> str:
        if gl.message.sender_address.as_hex != self.config["owner"]:
            raise gl.vm.UserError("EXPECTED: only owner")
        if depositor not in self.deposits:
            raise gl.vm.UserError("EXPECTED: no deposit for that address")
        if self.statuses[depositor] != "LOCKED":
            raise gl.vm.UserError("EXPECTED: deposit not LOCKED")
        if not recipient.startswith("0x") or len(recipient) != 42:
            raise gl.vm.UserError("EXPECTED: recipient must be a 0x address")
        self.statuses[depositor] = "PAYOUT_READY"
        self.recipients[depositor] = recipient
        return "PAYOUT_READY"

    # Emit the outbound transfer. multiplier "1" pays the exact deposit and
    # should succeed; a large multiplier overdrafts the contract and must fail.
    @gl.public.write
    def execute_payout(self, depositor: str, multiplier: str) -> str:
        if depositor not in self.deposits:
            raise gl.vm.UserError("EXPECTED: no deposit for that address")
        if self.statuses[depositor] != "PAYOUT_READY":
            raise gl.vm.UserError("EXPECTED: deposit not PAYOUT_READY")
        factor = int(multiplier)
        if factor < 1:
            raise gl.vm.UserError("EXPECTED: multiplier must be at least 1")
        amount = int(self.deposits[depositor]) * factor
        recipient = self.recipients[depositor]
        self.statuses[depositor] = "PAYOUT_PENDING"
        self.config["in_flight"] = depositor
        self.total_emitted = u256(int(self.total_emitted) + amount)
        _Recipient(Address(recipient)).emit_transfer(value=u256(amount))
        return str(amount)

    # Book an emitted payout as final. Moves nothing, emits nothing.
    @gl.public.write
    def confirm_payout(self, depositor: str) -> str:
        if depositor not in self.deposits:
            raise gl.vm.UserError("EXPECTED: no deposit for that address")
        if self.statuses[depositor] != "PAYOUT_PENDING":
            raise gl.vm.UserError("EXPECTED: no payout in flight for that address")
        self.statuses[depositor] = "PAID"
        if self.config["in_flight"] == depositor:
            self.config["in_flight"] = ""
        return "PAID"

    @gl.public.view
    def get_state(self, depositor: str) -> str:
        return json.dumps({
            "depositor": depositor,
            "amount": self.deposits[depositor] if depositor in self.deposits else "0",
            "status": self.statuses[depositor] if depositor in self.statuses else "NONE",
            "recipient": self.recipients[depositor] if depositor in self.recipients else "",
            "failures": self.failures[depositor] if depositor in self.failures else "0",
        })

    @gl.public.view
    def get_probe_status(self) -> str:
        return json.dumps({
            "owner": self.config["owner"],
            "in_flight": self.config["in_flight"],
            "last_hook_target": self.config["last_hook_target"],
            "last_hook_status": self.config["last_hook_status"],
            "hook_calls": int(self.hook_calls),
            "total_received": int(self.total_received),
            "total_emitted": int(self.total_emitted),
        })

    def __on_errored_message__(self):
        self.hook_calls = u256(int(self.hook_calls) + 1)
        target = self.config["in_flight"]
        self.config["last_hook_target"] = target
        if target == "":
            self.config["last_hook_status"] = "NO_TARGET"
            return
        if target not in self.statuses:
            self.config["last_hook_status"] = "UNKNOWN_TARGET"
            return
        if self.statuses[target] != "PAYOUT_PENDING":
            self.config["last_hook_status"] = "NOT_PENDING:" + self.statuses[target]
            return
        self.statuses[target] = "PAYOUT_READY"
        prior = int(self.failures[target]) if target in self.failures else 0
        self.failures[target] = str(prior + 1)
        self.config["in_flight"] = ""
        self.config["last_hook_status"] = "REOPENED"
