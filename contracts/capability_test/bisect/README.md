# Schema-load bisect artifacts (Stage 1)

Diagnostic contracts from the Stage 1 investigation into Studio's
"Could not load contract schema" / `VM_ERROR: invalid_contract` failure.
Each isolates one variable. They are kept as evidence for the conclusions
recorded in `docs/STAGE_1_ARCHITECTURE_AND_GEN_AUDIT.md` Addendum B.0.

Provenance note: `t4`, `t9` and `t10` are byte-for-byte copies of a native-GEN
probe written earlier for a different, unrelated GenLayer project by the same
author. Their comment headers still name that project. They are retained
**unmodified on purpose**: their exact bytes, including the non-ASCII ones, are
the evidence for the conclusion below, and rewriting the headers would destroy
the artifact. Nothing in Treasury Trial depends on, imports, or deploys them.

**These are not deployable production contracts.** `t4`, `t9` and `t10`
deliberately contain the 16 non-ASCII comment bytes (em dashes and section
signs) that caused the original failure, so they are intentionally excluded
from the ASCII guard in `tests/test_source_shape.py`, which scans only
`contracts/treasury_trial.py` and `contracts/capability_test/*.py`.

| File | Delta | Schema loaded |
|---|---|---|
| `t1_bare.py` | bare contract, u256, view + write | yes |
| `t2_interface.py` | + `@gl.evm.contract_interface` | yes |
| `t3_payable_transfer.py` | + payable write, `gl.message.value`, `emit_transfer` | yes |
| `t4_foresign_probe_verbatim.py` | the earlier project's probe unchanged | **no** |
| `t5_add_str_field.py` | + bare `str` storage field, TreeMap, UserError | yes |
| `t6_owner_in_map.py` | owner in a TreeMap written in `__init__` | yes |
| `t7_add_jsondumps.py` | + `json.dumps` in a view | yes |
| `t8_second_u256.py` | + second u256, refund method | yes |
| `t9_t4_with_v0216.py` | t4 with the version line changed | **no** |
| `t10_t4_no_version_line.py` | t4 with the version line deleted | **no** |
| `t11_no_slash.py` | rev4 minus the slash pair | yes |
| `t12_no_totals.py` | rev4 minus `get_totals` | yes |
| `t13_t8_plus_statuses.py` | t8 + a second TreeMap and a view | yes |
| `t15_payout_to_param.py` | t11 with the payout retargeted to a parameter | yes |

Conclusions: non-ASCII bytes anywhere break schema extraction (t4 vs t9/t10 vs
everything else); and a contract carrying a `mark_slashable` + `execute_slash`
pair alongside the refund pair fails to load, while the same payout behind one
parameterized method (t15) loads and worked live on StudioNet.
