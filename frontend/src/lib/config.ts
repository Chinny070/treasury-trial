/**
 * Treasury Chamber configuration.
 *
 * Every value has a compiled-in default for StudioNet, so the app runs with no
 * .env file. The contract address default is the canonical deployment recorded
 * in docs/STUDIONET_LIVE_BOND_CHECKLIST.md; it is not invented here.
 */
import { studionet } from "genlayer-js/chains";

const env = import.meta.env as unknown as Record<string, string | undefined>;

/** Canonical StudioNet deployment of the Treasury Trial protocol core. */
const CANONICAL_ADDRESS = "0x7cD15c0d4F4741C2Ce3DD807246b6f13aA7f82A1";

/**
 * Resolve the contract address, loudly.
 *
 * An unset override falls back to the canonical deployment above, which is a
 * real address on StudioNet. An override that is present but empty or
 * malformed is a configuration mistake, and the app refuses to start rather
 * than pointing at nothing and rendering what would look like an empty
 * protocol. There is no fixture or demo mode to fall back to.
 */
function resolveContractAddress(): { address: string; error: string | null } {
  const override = env.VITE_TREASURY_TRIAL_ADDRESS;
  if (override === undefined) {
    return { address: CANONICAL_ADDRESS, error: null };
  }
  const trimmed = override.trim();
  if (trimmed === "") {
    return {
      address: "",
      error:
        "VITE_TREASURY_TRIAL_ADDRESS is set but empty. Set it to a deployed Treasury Trial contract address, or remove it to use the canonical StudioNet deployment.",
    };
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    return {
      address: "",
      error: `VITE_TREASURY_TRIAL_ADDRESS is not a contract address: "${trimmed}".`,
    };
  }
  return { address: trimmed, error: null };
}

const resolved = resolveContractAddress();

/** Non-null when the app is misconfigured. main.tsx refuses to render. */
export const CONFIG_ERROR = resolved.error;

export const CONTRACT_ADDRESS = resolved.address as `0x${string}`;

/** Source fingerprint of the deployed contract, recorded at deploy time. */
export const CONTRACT_SHA256 =
  "95b6c42d53756d19701a67f9b62393ec02648ee4ac77c7c3ac57f1f9fd6a083e";

/** GenVM runner the contract pins. */
export const RUNTIME_PIN =
  "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6";

export const CHAIN = studionet;
export const CHAIN_ID: number = studionet.id;
export const CHAIN_ID_HEX = `0x${studionet.id.toString(16)}`;

export const RPC_URL =
  env.VITE_GENLAYER_RPC_URL ?? studionet.rpcUrls.default.http[0] ?? "";

export const EXPLORER_URL =
  env.VITE_GENLAYER_EXPLORER_URL ??
  studionet.blockExplorers?.default.url ??
  "https://genlayer-explorer.vercel.app";

export const RECEIPT_RETRIES = Number(env.VITE_RECEIPT_RETRIES ?? 200);
export const RECEIPT_INTERVAL_MS = Number(env.VITE_RECEIPT_INTERVAL_MS ?? 3000);

/** Native GEN has 18 decimals, matching the chain's nativeCurrency. */
export const GEN_DECIMALS = studionet.nativeCurrency.decimals;
export const GEN_SYMBOL = studionet.nativeCurrency.symbol;

/** The ABI this frontend was written against: 15 writes + 14 views. */
export const EXPECTED_WRITES = 15;
export const EXPECTED_VIEWS = 14;
export const EXPECTED_METHODS = EXPECTED_WRITES + EXPECTED_VIEWS;

export const explorerTx = (hash: string): string => `${EXPLORER_URL}/tx/${hash}`;
export const explorerAddress = (address: string): string =>
  `${EXPLORER_URL}/contracts/${address}`;
