# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass
    class Write:
        pass


class T2Interface(gl.Contract):
    n: u256

    def __init__(self):
        self.n = u256(0)

    @gl.public.view
    def get_n(self) -> str:
        return str(int(self.n))
