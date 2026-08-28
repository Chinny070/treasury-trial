# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
# T13 = T8 (passed) + ONLY a second TreeMap "statuses" and a get_status view.
# No new write methods. Isolates the storage/view delta from the method delta.

from genlayer import *

import json


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass
    class Write:
        pass


class T13T8PlusStatuses(gl.Contract):
    deposits: TreeMap[str, str]
    statuses: TreeMap[str, str]
    owner: str
    total_received: u256
    total_refunded: u256

    def __init__(self):
        self.owner = gl.message.sender_address.as_hex
        self.total_received = u256(0)
        self.total_refunded = u256(0)

    @gl.public.write.payable
    def deposit(self) -> str:
        amount = int(gl.message.value)
        if amount <= 0:
            raise gl.vm.UserError("EXPECTED: must send positive value")
        sender = gl.message.sender_address.as_hex
        self.deposits[sender] = str(amount)
        self.statuses[sender] = "LOCKED"
        self.total_received = u256(int(self.total_received) + amount)
        return str(amount)

    @gl.public.write
    def refund(self, recipient: str, amount: str) -> str:
        amt = int(amount)
        if amt <= 0:
            raise gl.vm.UserError("EXPECTED: amount must be positive")
        _Recipient(Address(recipient)).emit_transfer(value=u256(amt))
        self.total_refunded = u256(int(self.total_refunded) + amt)
        return amount

    @gl.public.view
    def get_owner(self) -> str:
        return self.owner

    @gl.public.view
    def get_status(self, depositor: str) -> str:
        return self.statuses[depositor] if depositor in self.statuses else "NONE"
