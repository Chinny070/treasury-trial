/** Shared presentational primitives. */

import type { ReactNode } from "react";
import type { Tone } from "../lib/format";
import { explorerAddress, explorerTx } from "../lib/config";
import { shortAddress } from "../lib/format";

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Card({
  title,
  eyebrow,
  actions,
  children,
  flush,
}: {
  title?: string;
  eyebrow?: string;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <section className={flush ? "card card-flush" : "card"}>
      {(title || eyebrow || actions) && (
        <header className="row row-between" style={{ marginBottom: "1rem" }}>
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            {title && <h3>{title}</h3>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function DataList({
  rows,
}: {
  rows: Array<[string, ReactNode] | null>;
}) {
  return (
    <dl className="datalist">
      {rows.filter(Boolean).map((row) => {
        const [label, value] = row as [string, ReactNode];
        return (
          <div className="datalist-row" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="mono">{children}</span>;
}

export function AddressLink({ address }: { address: string }) {
  if (!address) return <span className="faint">-</span>;
  return (
    <a className="mono" href={explorerAddress(address)} target="_blank" rel="noreferrer">
      {shortAddress(address)}
    </a>
  );
}

export function TxLink({ hash }: { hash: string }) {
  return (
    <a className="mono" href={explorerTx(hash)} target="_blank" rel="noreferrer">
      {shortAddress(hash)}
    </a>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty stack-tight">
      <h3>{title}</h3>
      {children && <p className="muted" style={{ margin: "0 auto" }}>{children}</p>}
      {action}
    </div>
  );
}

export function Loading({ label = "Reading contract state" }: { label?: string }) {
  return (
    <p className="muted small" role="status" aria-live="polite">
      {label}...
    </p>
  );
}

/**
 * A failed read is reported as a failure. It is never rendered as an empty
 * result: "we could not reach the contract" and "this case has no evidence"
 * are different facts, and showing the second for the first is a lie.
 */
export function ErrorNote({
  error,
  onRetry,
}: {
  error: string;
  onRetry?: () => void;
}) {
  return (
    <div className="tx tx-error" role="alert">
      <p className="tx-title">Could not read contract state</p>
      <p className="tx-detail">{error}</p>
      <p className="tx-detail" style={{ marginTop: "0.5rem" }}>
        This is a read failure, not an empty record. What is stored on-chain is
        unchanged and unknown to this page.
      </p>
      {onRetry && (
        <p style={{ marginTop: "0.75rem", marginBottom: 0 }}>
          <button type="button" className="btn btn-small" onClick={onRetry}>
            Try again
          </button>
        </p>
      )}
    </div>
  );
}

export function Pipeline({ steps }: { steps: string[] }) {
  return (
    <div className="pipeline" aria-label="Amendment lifecycle">
      {steps.map((step, index) => (
        <span key={step} style={{ display: "contents" }}>
          <span className="pipeline-step">{step}</span>
          {index < steps.length - 1 && (
            <span className="pipeline-sep" aria-hidden="true">
              &rarr;
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label>{label}</label>
      {children}
      {hint && !error && <p className="field-hint">{hint}</p>}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
