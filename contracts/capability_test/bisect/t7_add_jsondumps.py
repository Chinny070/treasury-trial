# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
# T7 = T5 + ONE json.dumps() call in a view. Isolates json.dumps.

from genlayer import *

import json


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass
    class Write:
        pass


class T7AddJsonDumps(gl.Contract):
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
    def totals(self) -> str:
        return json.dumps({"total_received": int(self.total_received), "owner": self.owner})
