/**
 * Read and write hooks over the contract adapter.
 *
 * useWriteFlow is the only way components submit transactions, so the
 * "submitted is not success" and "always revalidate" rules are structural
 * rather than a convention every component has to remember.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  submitWrite,
  type Revalidator,
  type WriteRequest,
} from "../lib/contract";
import {
  IDLE_TX,
  isBusy,
  type TxPhase,
  type TxState,
} from "../lib/txState";
import { useWallet } from "./useWallet";

export interface AsyncValue<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Read a contract value, with an explicit reload for post-write refresh. */
export function useRead<T>(
  loader: () => Promise<T>,
  deps: unknown[],
  options: { enabled?: boolean } = {},
): AsyncValue<T> {
  const enabled = options.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void loaderRef
      .current()
      .then((value) => {
        if (!cancelled) setData(value);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err?.message ?? "Could not read contract state.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, enabled]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload };
}

export interface WriteFlow {
  state: TxState;
  busy: boolean;
  /** Submit a write. Resolves to the terminal phase. */
  run: (request: WriteRequest, revalidate: Revalidator) => Promise<TxPhase>;
  reset: () => void;
}

/**
 * Drive one write through the full lifecycle.
 *
 * SUCCESS is returned only when the post-write revalidator confirms the
 * mutation in contract state. A returned value from the transaction is never
 * treated as evidence of anything.
 */
export function useWriteFlow(onConfirmed?: () => void): WriteFlow {
  const wallet = useWallet();
  const [state, setState] = useState<TxState>(IDLE_TX);
  const confirmedRef = useRef(onConfirmed);
  confirmedRef.current = onConfirmed;

  const reset = useCallback(() => setState(IDLE_TX), []);

  const run = useCallback(
    async (request: WriteRequest, revalidate: Revalidator): Promise<TxPhase> => {
      if (wallet.status !== "connected" || !wallet.account || !wallet.provider) {
        setState({ phase: "WALLET_REQUIRED" });
        return "WALLET_REQUIRED";
      }
      if (!wallet.onCorrectNetwork) {
        setState({ phase: "WRONG_NETWORK" });
        return "WRONG_NETWORK";
      }

      setState({ phase: "AWAITING_SIGNATURE", startedAt: Date.now() });

      const outcome = await submitWrite(
        { account: wallet.account, provider: wallet.provider },
        request,
        revalidate,
        (phase, hash) =>
          setState((prev) => ({ ...prev, phase, hash: hash ?? prev.hash })),
      );

      setState({
        phase: outcome.phase,
        hash: outcome.hash,
        receipt: outcome.receipt,
        revertReason: outcome.revertReason,
        message: outcome.error,
      });

      if (outcome.phase === "SUCCESS") {
        confirmedRef.current?.();
      }
      return outcome.phase;
    },
    [wallet.account, wallet.onCorrectNetwork, wallet.provider, wallet.status],
  );

  return { state, busy: isBusy(state.phase), run, reset };
}
