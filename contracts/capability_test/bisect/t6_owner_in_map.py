# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
# T6 = owner stored in a TreeMap written inside __init__ (the deployed Continuum
# pattern). Isolates whether TreeMap writes in __init__ are the problem.

from genlayer import *

import json


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass
    class Write:
        pass


class T6OwnerInMap(gl.Contract):
    deposits: TreeMap[str, str]
    params: TreeMap[str, str]
    total_received: u256

    def __init__(self):
        self.params["owner"] = gl.message.sender_address.as_hex
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
        return self.params["owner"] if "owner" in self.params else ""
