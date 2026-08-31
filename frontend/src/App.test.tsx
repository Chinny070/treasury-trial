/**
 * Route rendering and empty states.
 *
 * Contract reads are stubbed at the client boundary so these assert what the
 * app does with real shapes and with nothing at all. Nothing is seeded: an
 * empty deployment must look deliberate, not broken.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const readContract = vi.fn();

vi.mock("genlayer-js", () => ({
  createClient: () => ({
    readContract,
    writeContract: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
  }),
}));

import { App } from "./App";
import { WalletProvider } from "./hooks/useWallet";

const EMPTY_CONFIG = {
  owner: "0x0000000000000000000000000000000000000001",
  paused: false,
  payout_in_flight: "",
  policy_count: 0,
  case_count: 0,
  evidence_count: 0,
  challenge_count: 0,
  amendable_fields: ["maximum_individual_allocation"],
  dimensions: ["MATERIAL_CHANGE_CONFIRMED"],
  evidence_categories: ["PUBLIC_DOCUMENTATION"],
  challenge_grounds: ["EVIDENCE_FABRICATED"],
};

function at(path: string) {
  return render(
    <WalletProvider>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </WalletProvider>,
  );
}

beforeEach(() => {
  readContract.mockReset();
  readContract.mockImplementation(({ functionName }: { functionName: string }) => {
    if (functionName === "get_config") return Promise.resolve(JSON.stringify(EMPTY_CONFIG));
    return Promise.reject(new Error("not found"));
  });
});

describe("routes", () => {
  it("renders the landing page with live counts, not invented ones", async () => {
    at("/");
    expect(
      screen.getByRole("heading", { level: 1, name: /prove their case/i }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("Policies minted")).toBeInTheDocument(),
    );
    expect(document.body.textContent).toContain("Amendment cases");
  });

  it("renders the DAO registry with an honest empty recents list", () => {
    at("/daos");
    expect(screen.getByRole("heading", { level: 1, name: "DAOs" })).toBeInTheDocument();
    expect(screen.getByText(/keeps no global list of DAOs/i)).toBeInTheDocument();
  });

  it("shows a deliberate empty state for an unknown DAO", async () => {
    at("/daos/nope");
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "No such DAO" })).toBeInTheDocument(),
    );
  });

  it("shows a deliberate empty state for an unknown case", async () => {
    at("/cases/c_999");
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "No such case" })).toBeInTheDocument(),
    );
  });

  it("asks for a domain before listing cases, because there is no global index", () => {
    at("/cases");
    expect(screen.getByRole("heading", { name: "No domain selected" })).toBeInTheDocument();
  });

  it("makes the one-field constraint explicit when opening a case", () => {
    at("/cases/new");
    expect(screen.getByText(/exactly one change to exactly one field/i)).toBeInTheDocument();
  });

  it("states the Undetermined rule on the methodology page", () => {
    at("/methodology");
    expect(
      screen.getByRole("heading", { name: /Undetermined is not a verdict/i }),
    ).toBeInTheDocument();
  });

  it("reads the protocol vocabulary from the contract", async () => {
    at("/protocol");
    await waitFor(() => expect(screen.getByText("Vocabulary")).toBeInTheDocument());
    expect(document.body.textContent).toContain("MATERIAL_CHANGE_CONFIRMED");
  });

  it("reports the wallet write path as unavailable rather than pretending", async () => {
    at("/status");
    await waitFor(() => expect(screen.getByText("Wallet")).toBeInTheDocument());
    expect(screen.getByText("unsupported")).toBeInTheDocument();
  });

  it("renders a 404 for an unknown path", () => {
    at("/nowhere");
    expect(screen.getByRole("heading", { name: "Nothing here" })).toBeInTheDocument();
  });

  it("does not render seeded records anywhere on an empty deployment", async () => {
    at("/");
    await waitFor(() =>
      expect(screen.getByText("Policies minted")).toBeInTheDocument(),
    );
    const rows = screen.queryAllByRole("row");
    expect(rows).toHaveLength(0);
  });
});
