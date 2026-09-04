/**
 * Route rendering and empty states.
 *
 * Contract reads are stubbed at the client boundary so these assert what the
 * app does with real shapes and with nothing at all. Nothing is seeded: an
 * empty deployment must look deliberate, not broken.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("says why nothing happened when the DAO lookup is submitted empty", async () => {
    const user = userEvent.setup();
    at("/daos");
    await user.click(screen.getByRole("button", { name: "Open DAO" }));
    // The button used to return silently here, which read as a dead control.
    expect(screen.getByText(/enter a dao identifier first/i)).toBeInTheDocument();
  });

  it("rejects an identifier the contract would not accept, before navigating", async () => {
    const user = userEvent.setup();
    at("/daos");
    await user.type(screen.getByRole("textbox"), "ab");
    await user.click(screen.getByRole("button", { name: "Open DAO" }));
    expect(screen.getByText(/3 to 48 characters/i)).toBeInTheDocument();
  });

  it("says why nothing happened when the case lookup is submitted empty", async () => {
    const user = userEvent.setup();
    at("/cases");
    await user.click(screen.getByRole("button", { name: "Load cases" }));
    expect(screen.getByText(/enter a dao identifier first/i)).toBeInTheDocument();
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

const VERDICT_PROPOSED_CASE = {
  case_id: "c_7",
  dao_id: "example-dao-6",
  policy_id: "p_8",
  policy_version: 1,
  policy_hash: "abc",
  proposer: "0x2222222222222222222222222222222222222222",
  target_field: "allowed_spending_categories.add",
  old_value: '["a"]',
  proposed_value: "security",
  numeric_delta: "",
  rationale: "Because.",
  frozen_criteria: ["POLICY_PURPOSE_CONSISTENT"],
  frozen_required_categories: [],
  frozen_min_evidence: 2,
  frozen_min_independent: 1,
  frozen_challenge_window: 3600,
  frozen_evidence_window: 3600,
  treasury_address: "0x3333333333333333333333333333333333333333",
  bond_amount: "10000000000000000",
  created_at: 1,
  evidence_window_ends: 2,
  // Closed long ago.
  challenge_window_ends: 1000,
  status: "VERDICT_PROPOSED",
  evidence_frozen: true,
  frozen_evidence_ids: ["e_11", "e_12"],
  evidence_fingerprint: "ff",
  current_verdict_json: "",
  proposed_decision: "ACCEPTED",
  decision_reason: "",
  verdict_history: [{ source: "ADJUDICATION", decision: "ACCEPTED", reason: "" }],
  final_decision: "",
  resulting_policy_id: "",
  finalized_at: 0,
};

describe("finalization is offered when the contract would accept it", () => {
  it("offers Finalize on an uncontested VERDICT_PROPOSED case with a closed window", async () => {
    // finalize_case accepts VERDICT_PROPOSED as well as CHALLENGE_WINDOW, and
    // CHALLENGE_WINDOW only exists once someone challenges. Gating the button
    // on CHALLENGE_WINDOW hid it from every uncontested case.
    readContract.mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === "get_case")
        return Promise.resolve(JSON.stringify(VERDICT_PROPOSED_CASE));
      if (functionName === "get_case_challenges")
        return Promise.resolve(JSON.stringify({ total: 0, items: [] }));
      return Promise.reject(new Error("not found"));
    });

    at("/cases/c_7");
    // The button itself sits behind the wallet gate; the action card is what
    // proves the app considers this case finalizable.
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /available actions/i }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/finalizing writes the final decision/i)).toBeInTheDocument();
  });

  it("explains the wait instead of hiding everything while the window is open", async () => {
    readContract.mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === "get_case")
        return Promise.resolve(
          JSON.stringify({
            ...VERDICT_PROPOSED_CASE,
            challenge_window_ends: Math.floor(Date.now() / 1000) + 3600,
          }),
        );
      if (functionName === "get_case_challenges")
        return Promise.resolve(JSON.stringify({ total: 0, items: [] }));
      return Promise.reject(new Error("not found"));
    });

    at("/cases/c_7");
    await waitFor(() =>
      expect(screen.getByText(/challenge window is still open/i)).toBeInTheDocument(),
    );
    expect(
      screen.queryByText(/finalizing writes the final decision/i),
    ).not.toBeInTheDocument();
  });

  it("offers the challenge form on a VERDICT_PROPOSED case, not only after one exists", async () => {
    readContract.mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === "get_case")
        return Promise.resolve(
          JSON.stringify({
            ...VERDICT_PROPOSED_CASE,
            challenge_window_ends: Math.floor(Date.now() / 1000) + 3600,
          }),
        );
      if (functionName === "get_case_challenges")
        return Promise.resolve(JSON.stringify({ total: 0, items: [] }));
      return Promise.reject(new Error("not found"));
    });

    at("/cases/c_7/challenge");
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /raise a challenge/i })).toBeInTheDocument(),
    );
  });
});
