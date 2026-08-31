/**
 * The visible half of the transaction lifecycle.
 *
 * Two rules are enforced here and nowhere else in the UI:
 *
 *  1. A submitted transaction is never rendered as a result.
 *  2. CONSENSUS_UNDETERMINED gets its own first-class treatment. It is a
 *     consensus condition, not a verdict, and the copy says so explicitly so
 *     nobody reads it as "GenLayer rejected my amendment".
 */

import { PHASE_COPY, isRetryable, type TxState } from "../lib/txState";
import { TxLink } from "./ui";
import { useWallet } from "../hooks/useWallet";

function toneClass(phase: TxState["phase"]): string {
  switch (phase) {
    case "IDLE":
      return "tx tx-idle";
    case "SUCCESS":
      return "tx tx-success";
    case "EXECUTION_ERROR":
    case "STATE_MISMATCH":
      return "tx tx-error";
    case "CONSENSUS_UNDETERMINED":
    case "TIMEOUT":
    case "USER_REJECTED":
    case "WALLET_REQUIRED":
    case "WRONG_NETWORK":
      return "tx tx-warn";
    default:
      return "tx tx-busy";
  }
}

export function TransactionPanel({
  state,
  onRetry,
}: {
  state: TxState;
  onRetry?: () => void;
}) {
  const wallet = useWallet();
  if (state.phase === "IDLE") return null;

  const copy = PHASE_COPY[state.phase];
  const isLive =
    state.phase === "AWAITING_SIGNATURE" ||
    state.phase === "SUBMITTED" ||
    state.phase === "PROCESSING" ||
    state.phase === "STATE_REVALIDATING";

  return (
    <div
      className={toneClass(state.phase)}
      role={state.phase === "SUCCESS" ? "status" : "alert"}
      aria-live="polite"
    >
      <p className="tx-title">{copy.title}</p>
      <p className="tx-detail">{state.message ?? copy.detail}</p>

      {state.revertReason && (
        <p className="tx-detail" style={{ marginTop: "0.5rem" }}>
          <strong>Contract said:</strong> <span className="mono">{state.revertReason}</span>
        </p>
      )}

      {state.phase === "CONSENSUS_UNDETERMINED" && (
        <p className="tx-detail" style={{ marginTop: "0.5rem" }}>
          Undetermined means validators could not agree on the outcome, so the
          protocol discarded the attempted change. It is not a judgment about
          the merits of your amendment. Nothing was written and nothing was
          spent beyond gas.
        </p>
      )}

      {state.phase === "STATE_MISMATCH" && (
        <p className="tx-detail" style={{ marginTop: "0.5rem" }}>
          The transaction settled but the record on-chain does not show the
          change. This is reported as a failure rather than a success because
          contract state, not the transaction return value, is what counts.
        </p>
      )}

      {state.phase === "WRONG_NETWORK" && (
        <p style={{ marginTop: "0.75rem", marginBottom: 0 }}>
          <button type="button" className="btn btn-small" onClick={() => void wallet.switchNetwork()}>
            Switch to StudioNet
          </button>
        </p>
      )}

      {state.phase === "WALLET_REQUIRED" && (
        <p style={{ marginTop: "0.75rem", marginBottom: 0 }}>
          <button type="button" className="btn btn-small" onClick={() => void wallet.connect()}>
            Connect wallet
          </button>
        </p>
      )}

      {(state.hash || state.receipt) && (
        <div className="tx-meta">
          {state.hash && (
            <span>
              tx <TxLink hash={state.hash} />
              {isLive && " (submitted, not a result)"}
            </span>
          )}
          {state.receipt?.statusName && <span>status: {state.receipt.statusName}</span>}
          {state.receipt?.executionResultName && (
            <span>execution: {state.receipt.executionResultName}</span>
          )}
          {state.receipt?.numOfRounds && <span>rounds: {state.receipt.numOfRounds}</span>}
          {state.receipt?.consensusFinal !== undefined && (
            <span>final: {String(state.receipt.consensusFinal)}</span>
          )}
        </div>
      )}

      {onRetry && isRetryable(state.phase) && (
        <p style={{ marginTop: "0.75rem", marginBottom: 0 }}>
          <button type="button" className="btn btn-small" onClick={onRetry}>
            Try again
          </button>
        </p>
      )}
    </div>
  );
}

/** Gate that explains why a write is unavailable without faking a wallet. */
export function WriteGate({ children }: { children: React.ReactNode }) {
  const wallet = useWallet();

  if (wallet.status === "unsupported") {
    return (
      <div className="tx tx-warn">
        <p className="tx-title">No wallet detected</p>
        <p className="tx-detail">
          This browser has no injected wallet, so protocol transactions cannot be
          signed here. All records on this page remain readable.
        </p>
      </div>
    );
  }

  if (wallet.status !== "connected") {
    return (
      <div className="tx tx-warn">
        <p className="tx-title">Wallet required</p>
        <p className="tx-detail">
          Connect a wallet to submit this transaction. Browsing stays read-only
          until you do.
        </p>
        <p style={{ marginTop: "0.75rem", marginBottom: 0 }}>
          <button type="button" className="btn btn-small" onClick={() => void wallet.connect()}>
            Connect wallet
          </button>
        </p>
      </div>
    );
  }

  if (!wallet.onCorrectNetwork) {
    return (
      <div className="tx tx-warn">
        <p className="tx-title">Wrong network</p>
        <p className="tx-detail">
          Your wallet is on chain {wallet.chainId ?? "unknown"}. Treasury Trial is
          deployed on GenLayer StudioNet.
        </p>
        <p style={{ marginTop: "0.75rem", marginBottom: 0 }}>
          <button type="button" className="btn btn-small" onClick={() => void wallet.switchNetwork()}>
            Switch to StudioNet
          </button>
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
