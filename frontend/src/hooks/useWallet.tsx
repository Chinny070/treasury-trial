/**
 * Wallet and network state.
 *
 * Read-only browsing never requires a wallet. A wallet is required only to
 * sign writes, and a connected wallet is never faked: if no injected provider
 * exists we say so plainly rather than pretending to be disconnected.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CHAIN_ID, CHAIN_ID_HEX, CHAIN, RPC_URL, EXPLORER_URL } from "../lib/config";
import type { Address, Eip1193Provider } from "../lib/contract";

export type WalletStatus =
  | "unsupported"
  | "disconnected"
  | "connecting"
  | "connected";

export interface WalletState {
  status: WalletStatus;
  account: Address | null;
  chainId: number | null;
  onCorrectNetwork: boolean;
  provider: Eip1193Provider | null;
  error: string | null;
  connect: () => Promise<void>;
  switchNetwork: () => Promise<void>;
}

const WalletContext = createContext<WalletState | null>(null);

function getProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  return window.ethereum ?? null;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const provider = useMemo(getProvider, []);
  const [status, setStatus] = useState<WalletStatus>(
    provider ? "disconnected" : "unsupported",
  );
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshChain = useCallback(async () => {
    if (!provider) return;
    try {
      const raw = (await provider.request({ method: "eth_chainId" })) as string;
      setChainId(Number.parseInt(raw, 16));
    } catch {
      setChainId(null);
    }
  }, [provider]);

  /** Silent reconnect: only reports accounts already authorised. */
  useEffect(() => {
    if (!provider) return;
    let cancelled = false;
    void (async () => {
      try {
        const accounts = (await provider.request({
          method: "eth_accounts",
        })) as string[];
        if (cancelled) return;
        if (accounts.length > 0 && accounts[0]) {
          setAccount(accounts[0] as Address);
          setStatus("connected");
          await refreshChain();
        }
      } catch {
        /* Staying disconnected is the correct outcome here. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, refreshChain]);

  useEffect(() => {
    if (!provider?.on) return;
    const onAccounts = (...args: unknown[]) => {
      const accounts = (args[0] ?? []) as string[];
      if (accounts.length === 0 || !accounts[0]) {
        setAccount(null);
        setStatus("disconnected");
      } else {
        setAccount(accounts[0] as Address);
        setStatus("connected");
      }
    };
    const onChain = (...args: unknown[]) => {
      const raw = args[0];
      setChainId(typeof raw === "string" ? Number.parseInt(raw, 16) : null);
    };
    provider.on("accountsChanged", onAccounts);
    provider.on("chainChanged", onChain);
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, [provider]);

  const connect = useCallback(async () => {
    if (!provider) {
      setError("No injected wallet was found in this browser.");
      return;
    }
    setError(null);
    setStatus("connecting");
    try {
      const accounts = (await provider.request({
        method: "eth_requestAccounts",
      })) as string[];
      if (accounts.length > 0 && accounts[0]) {
        setAccount(accounts[0] as Address);
        setStatus("connected");
        await refreshChain();
      } else {
        setStatus("disconnected");
      }
    } catch (err) {
      setStatus("disconnected");
      const message = (err as Error)?.message ?? "Wallet connection was declined.";
      setError(message);
    }
  }, [provider, refreshChain]);

  const switchNetwork = useCallback(async () => {
    if (!provider) return;
    setError(null);
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN_ID_HEX }],
      });
      await refreshChain();
    } catch (err) {
      const code = (err as { code?: number })?.code;
      if (code !== 4902) {
        setError((err as Error)?.message ?? "Could not switch network.");
        return;
      }
      try {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: CHAIN_ID_HEX,
              chainName: CHAIN.name,
              nativeCurrency: CHAIN.nativeCurrency,
              rpcUrls: [RPC_URL],
              blockExplorerUrls: [EXPLORER_URL],
            },
          ],
        });
        await refreshChain();
      } catch (addErr) {
        setError((addErr as Error)?.message ?? "Could not add StudioNet.");
      }
    }
  }, [provider, refreshChain]);

  const value: WalletState = {
    status,
    account,
    chainId,
    onCorrectNetwork: chainId === CHAIN_ID,
    provider,
    error,
    connect,
    switchNetwork,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
