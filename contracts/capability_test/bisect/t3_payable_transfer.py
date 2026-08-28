# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass
    class Write:
        pass


class T3PayableTransfer(gl.Contract):
    total: u256

    def __init__(self):
        self.total = u256(0)

    @gl.public.write.payable
    def deposit(self) -> str:
        self.total = u256(int(self.total) + int(gl.message.value))
        return str(int(self.total))

    @gl.public.write
    def payout(self, to: str, amount: str) -> str:
        _Recipient(Address(to)).emit_transfer(value=u256(int(amount)))
        return amount

    @gl.public.view
    def get_total(self) -> str:
        return str(int(self.total))
