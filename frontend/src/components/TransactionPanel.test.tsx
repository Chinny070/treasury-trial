/**
 * What the user is actually told.
 *
 * The rule under test is that no pre-confirmation phase renders as a result,
 * and that Undetermined reads as a consensus condition rather than a verdict.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WalletProvider } from "../hooks/useWallet";
import { EvidenceCard } from "./protocol";
import { TransactionPanel, WriteGate } from "./TransactionPanel";
import type { TxState } from "../lib/txState";

const show = (state: TxState) =>
  render(
    <WalletProvider>
      <TransactionPanel state={state} />
    </WalletProvider>,
  );

describe("TransactionPanel", () => {
  it("renders nothing at rest", () => {
    const { container } = show({ phase: "IDLE" });
    expect(container.firstChild).toBeNull();
  });

  it("never says success while a transaction is only submitted", () => {
    show({ phase: "SUBMITTED", hash: "0xabc" });
    const text = document.body.textContent?.toLowerCase() ?? "";
    expect(text).not.toContain("success");
    expect(text).not.toContain("confirmed");
  });

  it("does not claim success while state is still being revalidated", () => {
    show({ phase: "STATE_REVALIDATING", hash: "0xabc" });
    expect(screen.getByRole("alert").className).toContain("tx-busy");
  });

  it("presents Undetermined as recoverable and not as a rejection", () => {
    show({
      phase: "CONSENSUS_UNDETERMINED",
      hash: "0xabc",
      receipt: {
        statusName: "UNDETERMINED",
        undetermined: true,
        executionErrored: false,
        decided: false,
      },
    });
    const panel = screen.getByRole("alert");
    expect(panel.className).toContain("tx-warn");
    expect(panel.textContent).toMatch(/not a judgment about the merits/i);
    expect(panel.textContent?.toLowerCase()).not.toContain("rejected your");
  });

  it("reports a state mismatch as a failure, not a success", () => {
    show({
      phase: "STATE_MISMATCH",
      hash: "0xabc",
      receipt: {
        statusName: "ACCEPTED",
        executionResultName: "FINISHED_WITH_RETURN",
        undetermined: false,
        executionErrored: false,
        decided: true,
      },
    });
    const panel = screen.getByRole("alert");
    expect(panel.className).toContain("tx-error");
  });

  it("shows the revert reason the contract gave", () => {
    show({
      phase: "EXECUTION_ERROR",
      hash: "0xabc",
      revertReason: "bond already locked",
    });
    expect(screen.getByText("bond already locked")).toBeInTheDocument();
  });

  it("marks a confirmed write as status, not alert", () => {
    show({ phase: "SUCCESS", hash: "0xabc" });
    expect(screen.getByRole("status").className).toContain("tx-success");
  });

  it("surfaces raw receipt signals rather than hiding them", () => {
    show({
      phase: "SUCCESS",
      hash: "0xabc",
      receipt: {
        statusName: "ACCEPTED",
        executionResultName: "FINISHED_WITH_RETURN",
        numOfRounds: "2",
        consensusFinal: false,
        undetermined: false,
        executionErrored: false,
        decided: true,
      },
    });
    expect(document.body.textContent).toContain("ACCEPTED");
  });
});

describe("WriteGate", () => {
  it("blocks writes and explains why when no wallet is present", () => {
    render(
      <WalletProvider>
        <WriteGate>
          <button type="button">Lock bond</button>
        </WriteGate>
      </WalletProvider>,
    );
    // jsdom has no injected provider, so this is the unsupported branch.
    expect(screen.queryByText("Lock bond")).toBeNull();
    expect(screen.getByText(/no wallet detected/i)).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/remain readable/i);
  });
});

describe("EvidenceCard fetch status", () => {
  const base = {
    evidence_id: "e_9",
    case_id: "c_6",
    challenge_id: "",
    submitter: "0x1111111111111111111111111111111111111111",
    category: "INFRA_REQUIREMENT" as const,
    title: "A source",
    source_url: "https://example.org/a",
    url_normalised: "https://example.org/a",
    source_host: "example.org",
    excerpt: "",
    claim: "It says a thing.",
    independence_declared: "INDEPENDENT" as const,
    affiliation_note: "",
    image_not_machine_verified: false,
    fetched_excerpt: "",
    submitted_at: 1,
  };

  it("does not call an unfetched source unretrievable", () => {
    // Live: a freshly submitted source showed "not retrievable on-chain"
    // before adjudication had ever tried to fetch it.
    render(<EvidenceCard record={{ ...base, fetch_status: "NOT_ATTEMPTED" }} />);
    expect(screen.queryByText(/not retrievable/i)).not.toBeInTheDocument();
    expect(screen.getByText(/not fetched yet/i)).toBeInTheDocument();
  });

  it("does say unretrievable once a fetch has actually failed", () => {
    render(<EvidenceCard record={{ ...base, fetch_status: "UNAVAILABLE" }} />);
    expect(screen.getByText(/not retrievable/i)).toBeInTheDocument();
  });
});
