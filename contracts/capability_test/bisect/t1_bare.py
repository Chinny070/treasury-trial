# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *


class T1Bare(gl.Contract):
    n: u256

    def __init__(self):
        self.n = u256(0)

    @gl.public.write
    def bump(self) -> str:
        self.n = u256(int(self.n) + 1)
        return str(int(self.n))

    @gl.public.view
    def get_n(self) -> str:
        return str(int(self.n))
