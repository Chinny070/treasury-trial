/** Chrome: masthead, navigation, wallet control, footer. */

import { NavLink, Link, Outlet } from "react-router-dom";
import { CHAIN, CONTRACT_ADDRESS } from "../lib/config";
import { shortAddress } from "../lib/format";
import { useWallet } from "../hooks/useWallet";
import { AddressLink } from "./ui";

const NAV = [
  { to: "/daos", label: "DAOs" },
  { to: "/cases", label: "Cases" },
  { to: "/methodology", label: "Methodology" },
  { to: "/protocol", label: "Protocol" },
  { to: "/integration", label: "Integration" },
  { to: "/status", label: "Status" },
];

function WalletControl() {
  const wallet = useWallet();

  if (wallet.status === "unsupported") {
    return (
      <span className="small faint" title="No injected wallet in this browser">
        Read-only
      </span>
    );
  }

  if (wallet.status === "connected" && wallet.account) {
    return (
      <div className="row" style={{ gap: "0.5rem" }}>
        {!wallet.onCorrectNetwork && (
          <button
            type="button"
            className="btn btn-small"
            onClick={() => void wallet.switchNetwork()}
          >
            Switch to StudioNet
          </button>
        )}
        <Link className="btn btn-small" to="/account">
          <span className="mono">{shortAddress(wallet.account)}</span>
        </Link>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="btn btn-small btn-primary"
      onClick={() => void wallet.connect()}
      disabled={wallet.status === "connecting"}
    >
      {wallet.status === "connecting" ? "Connecting..." : "Connect wallet"}
    </button>
  );
}

export function Layout() {
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="masthead">
        <div className="masthead-inner">
          <Link to="/" className="wordmark">
            Treasury<span>Chamber</span>
          </Link>
          <nav aria-label="Primary">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <WalletControl />
        </div>
      </header>

      <main id="main">
        <Outlet />
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <span>
            Treasury Trial on {CHAIN.name}. Every record shown is read directly
            from the deployed contract.
          </span>
          <span>
            Contract <AddressLink address={CONTRACT_ADDRESS} />
          </span>
        </div>
      </footer>
    </div>
  );
}
