# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
# T5 = T4 (the known-good baseline probe) + one bare `str` storage field.
# Isolates whether a
# top-level `str` storage field breaks Studio schema extraction.

from genlayer import *

import json


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass
    class Write:
        pass


class T5AddStrField(gl.Contract):
    deposits: TreeMap[str, str]
    owner: str
    total_received: u256

    def __init__(self):
        self.owner = gl.message.sender_address.as_hex
        self.total_received = u256(0)

    @gl.public.write.payable
    def deposit(self) -> str:
        amount = int(gl.message.value)
        if amount <= 0:
            raise gl.vm.UserError("EXPECTED: must send positive value")
        sender = gl.message.sender_address.as_hex
        self.deposits[sender] = str(amount)
        self.total_received = u256(int(self.total_received) + amount)
        return str(amount)

    @gl.public.view
    def get_owner(self) -> str:
        return self.owner
