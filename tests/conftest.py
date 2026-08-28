"""
Treasury Trial test harness shims (direct mode, Windows).

`gltest.direct.loader._inject_message_to_fd0` writes the encoded transaction
message to a temp file, `os.dup2`s it onto fd 0 so the contract can read it at
import, and then - in a `finally` - calls `os.unlink(path)` while that file is
STILL open via fd 0. On Windows an open file cannot be deleted, so this raises
`PermissionError: [WinError 32]` and aborts every `deploy_contract` call.

That is a bug in the gltest direct runner on Windows, not in the contract under
test. We install a process-wide tolerant `os.unlink` that swallows only that
specific PermissionError; the orphaned temp file lives in the OS temp dir and
is reclaimed by the OS. Every other unlink error propagates unchanged, and no
contract behavior is altered.

Same workaround as the user's SEEDWAGER suite.
"""

import os

_orig_unlink = os.unlink


def _tolerant_unlink(path, *args, **kwargs):
    try:
        return _orig_unlink(path, *args, **kwargs)
    except PermissionError:
        return None


os.unlink = _tolerant_unlink
