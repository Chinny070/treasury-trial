# Treasury Trial

**Every treasury decision has a case.**

Evidence-backed policy amendment for DAO treasuries, adjudicated by GenLayer
under the DAO's own pre-existing frozen policy, with real native GEN amendment
bonds.

A DAO writes a treasury policy: permitted spending categories, a maximum
individual allocation, evidence requirements, amendment criteria, challenge
rules, a bond requirement. To change one of those rules, a proposer opens an
**amendment case**, locks a GEN bond, and submits evidence. GenLayer decides
whether that evidence justifies the change *under the rules the DAO already
wrote*. Accepted amendments create a new immutable policy version; rejected
ones forfeit the bond to the DAO treasury.

Governance defines the rules. GenLayer adjudicates claims under those rules.

This is not a prediction market. There is no wagering. GEN is an accountability
bond, not a bet.

## Status

| Stage | State |
|---|---|
| Stage 1 - architecture and native GEN audit | complete, [report](docs/STAGE_1_ARCHITECTURE_AND_GEN_AUDIT.md) |
| Native GEN on StudioNet | **live-verified** - deposit, custody, refund, third-party payout, replay protection |
| Stage 2 - protocol core contract | complete, [reference](docs/STAGE_2_CONTRACT_ARCHITECTURE.md) |
| Stage 3 - frontend | not started |

The production contract is **not deployed**. Its schema has not yet been loaded
in Studio - that is the first item of the
[live checklist](docs/STUDIONET_LIVE_BOND_CHECKLIST.md).

## Layout

```
contracts/treasury_trial.py          production Intelligent Contract
contracts/capability_test/           non-production native GEN probes (Stage 1)
contracts/capability_test/bisect/    schema-load bisect artifacts
docs/                                architecture, audit, live checklist
tests/                               pytest suite (direct mode, nondeterminism mocked)
```

## Tests

```bash
python -m pytest tests/ -q
```

The suite mocks every web and model call and never touches live GEN. Real value
movement is covered by the manual
[StudioNet checklist](docs/STUDIONET_LIVE_BOND_CHECKLIST.md).

## Runtime

Pinned to `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`
(GenVM v0.2.16), StudioNet. Contract source must remain **pure ASCII** - a
single non-ASCII byte, comments included, makes Studio schema extraction fail.
