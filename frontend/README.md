# Treasury Chamber

The frontend for Treasury Trial. It is a static React application that talks
directly to the Intelligent Contract on GenLayer StudioNet.

There is no backend, no database, no indexer, and no server-side API. Every
record shown is read from the deployed contract at request time, and every write
is signed by the visitor's own wallet. Nothing is seeded, mocked or illustrative:
on an empty deployment the app shows deliberate empty states.

## Running it

```bash
npm install
npm run dev
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck, then production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint, zero warnings tolerated |
| `npm test` | Vitest |

## Configuration

Every value has a compiled-in StudioNet default, so the app runs with no `.env`
file at all. Override only if you are pointing at a different deployment.

| Variable | Default |
| --- | --- |
| `VITE_TREASURY_TRIAL_ADDRESS` | `0x7cD15c0d4F4741C2Ce3DD807246b6f13aA7f82A1` |
| `VITE_GENLAYER_RPC_URL` | StudioNet default from `genlayer-js/chains` |
| `VITE_GENLAYER_EXPLORER_URL` | `https://genlayer-explorer.vercel.app` |
| `VITE_RECEIPT_RETRIES` | `200` |
| `VITE_RECEIPT_INTERVAL_MS` | `3000` |

The deployed contract's source fingerprint is compiled in as well:
`95b6c42d53756d19701a67f9b62393ec02648ee4ac77c7c3ac57f1f9fd6a083e`, runner pin
`py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`.

## Network and wallet

- **Chain:** GenLayer StudioNet, chain id **61999**
- **Native currency:** GEN, 18 decimals
- **Reading** requires no wallet. Every view is public.
- **Writing** requires an injected EIP-1193 wallet on StudioNet. If the wallet is
  on another chain the app offers `wallet_switchEthereumChain`, falling back to
  `wallet_addEthereumChain` when the network is unknown to the wallet.

The application never asks for, stores, or transmits a private key. It never
deploys contracts and never broadcasts a transaction the user has not signed.

## The transaction lifecycle

This is the part of the app that matters most, and the part most likely to be
got wrong by a frontend written against a normal EVM chain.

**A transaction hash is not success. A returned value is not success.**

Every write goes through one function, `submitWrite` in `src/lib/contract.ts`,
which runs the following sequence and has no shortcuts around it:

1. `AWAITING_SIGNATURE` — the wallet is asked to sign.
2. `SUBMITTED` / `PROCESSING` — a hash exists. Nothing is claimed.
3. `waitForTransactionReceipt` — wait for the transaction to settle.
4. Inspect the consensus result:
   - `UNDETERMINED`, `CANCELED`, `VALIDATORS_TIMEOUT`, `LEADER_TIMEOUT`
     → `CONSENSUS_UNDETERMINED`. Stop.
   - `FINISHED_WITH_ERROR` → `EXECUTION_ERROR`, with the revert reason. Stop.
   - Not `ACCEPTED` or `FINALIZED` → `TIMEOUT`. Stop.
5. `STATE_REVALIDATING` — re-read authoritative contract state.
6. `SUCCESS` — only if that re-read confirms the mutation. Otherwise
   `STATE_MISMATCH`, which is reported as a failure.

Components cannot bypass this: `useWriteFlow` is the only write path, and it
requires a revalidator argument.

### Why Undetermined has its own screen

Undetermined is a **transaction and consensus condition, not a semantic
verdict**. Validators failed to converge, so the protocol discarded the
attempted write: nothing was stored and the case is exactly where it was. The UI
says so in those words, and offers the operation again. It is never rendered as
a rejection of the amendment, and never as a success.

### Why every write re-reads state

During live testing on StudioNet, a `request_adjudication` transaction reported
a settled receipt with an accepted outcome while `get_verdict` still showed the
case at `EVIDENCE_FROZEN` with an empty verdict history, and `finalize_case`
then failed. Only re-reading the contract told the truth.

Each write therefore names what "it actually happened" means for it
(`src/lib/contract.ts`, `revalidators`):

| Write | Confirmed by |
| --- | --- |
| `register_dao` | `get_dao` returns the id |
| `create_policy` | `get_current_policy` returns version ≥ 1 |
| `open_amendment_case` | the DAO's case counter moved |
| `withdraw_case` | case status is `WITHDRAWN` |
| `lock_bond` | bond status is `LOCKED` |
| `submit_evidence` | evidence count increased |
| `freeze_evidence` | `evidence_frozen` is true |
| `request_adjudication` | `get_verdict` has a decision, a non-empty history, and has left `EVIDENCE_FROZEN` |
| `open_challenge` | challenge count increased |
| `resolve_challenge` | that challenge is `RESOLVED` |
| `finalize_case` | status `DECIDED` **and** a final decision recorded |
| `execute_payout` | bond status is `PAYOUT_PENDING` |
| `confirm_payout` | bond status is `REFUNDED` or `SLASHED` |
| `pause` / `unpause` | `get_config().paused` matches |

### Payout is two steps, deliberately

`execute_payout(case_id)` takes only a case id: the recipient and amount come
from state frozen at finalization, so no caller — including the contract owner —
can redirect where the GEN goes.

`confirm_payout` is **never** called automatically because `execute_payout`
returned. A returned value is not evidence that GEN arrived. The UI leaves the
bond at *payout pending*, shows the recipient and amount, and asks the user to
verify the transfer on the explorer before confirming.

## Bonds are real native GEN

The proposer bond is native GEN sent as transaction `value` on the one payable
method, `lock_bond`. It is not an accounting unit, a token balance, or a
simulated escrow. The contract requires the exact frozen amount; any other value
is rejected. A rejected case forfeits the bond to the DAO treasury address that
was frozen into the case; accepted, invalid and withdrawn cases are refundable.

This is a bond, not a wager. There is no market, no YES/NO position, and nothing
to trade.

## Routes

| Path | Page |
| --- | --- |
| `/` | Landing, with live counts from `get_config()` |
| `/daos` | Registry lookup |
| `/daos/new` | Register an identifier |
| `/daos/:daoId` | DAO overview: current policy, case docket, controller |
| `/daos/:daoId/policy` | Immutable policy lineage |
| `/daos/:daoId/policy/new` | Publish version 1 |
| `/cases` | Case explorer, per DAO |
| `/cases/new` | Open an amendment case |
| `/cases/:caseId` | Case overview and frozen rules |
| `/cases/:caseId/evidence` | Evidence, submission, freeze |
| `/cases/:caseId/adjudication` | Verdict and adjudication |
| `/cases/:caseId/challenge` | Challenges |
| `/cases/:caseId/bond` | Bond, payout, confirmation |
| `/methodology` | How judgment works, and its limits |
| `/protocol` | Live protocol surface |
| `/integration` | Reading the contract yourself |
| `/status` | Diagnostics |
| `/account` | Connected address, owner pause controls |

The contract has no global enumeration of DAOs or cases, by design: there is no
unbounded collection to iterate. So the registry is a lookup, and the case
explorer is scoped to one DAO. Identifiers you have visited are remembered in
`localStorage` as a convenience; that is browser state, never protocol state.

## Deployment

Live at **https://treasury-trial.vercel.app**, deployed from `frontend/` only.

The build output in `dist/` is fully static. For Vercel:

- Framework preset: **Vite**
- Build command: `npm run build`
- Output directory: `dist`
- Add a rewrite so client-side routes resolve:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

Environment variables are optional; without any, the build targets the canonical
StudioNet deployment above.
