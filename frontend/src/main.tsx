import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { WalletProvider } from "./hooks/useWallet";
import { CONFIG_ERROR } from "./lib/config";
import "./styles/app.css";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root");

const root = createRoot(container);

if (CONFIG_ERROR) {
  // A misconfigured deployment must say so. It must never render a UI that
  // looks like a protocol with nothing in it.
  root.render(
    <div className="page page-narrow">
      <div className="tx tx-error" role="alert">
        <p className="tx-title">Treasury Chamber is misconfigured</p>
        <p className="tx-detail">{CONFIG_ERROR}</p>
        <p className="tx-detail" style={{ marginTop: "0.5rem" }}>
          No contract is being read, and nothing shown here would be real. See
          <code> frontend/.env.example</code>.
        </p>
      </div>
    </div>,
  );
} else {
  root.render(
    <StrictMode>
      <BrowserRouter>
        <WalletProvider>
          <App />
        </WalletProvider>
      </BrowserRouter>
    </StrictMode>,
  );
}
