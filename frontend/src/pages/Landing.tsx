import { Link } from "react-router-dom";
import { reads } from "../lib/contract";
import { useRead } from "../hooks/useContract";
import { Card, DataList, Pipeline } from "../components/ui";

const LIFECYCLE = [
  "Policy",
  "Amendment",
  "GEN bond",
  "Evidence",
  "GenLayer judgment",
  "Challenge",
  "New policy version",
  "Refund or slash",
];

export function Landing() {
  const config = useRead(() => reads.config(), []);

  return (
    <>
      <section className="hero">
        <div className="page" style={{ paddingBottom: 0, paddingTop: 0 }}>
          <p className="eyebrow">Treasury Trial</p>
          <h1>
            Governance amendments should prove their case before rewriting
            treasury policy.
          </h1>
          <p className="lede" style={{ marginTop: "1.25rem" }}>
            A DAO writes down the rules its treasury runs on. Changing one of
            those rules becomes a case: an evidenced argument, a bond of real
            GEN, and a judgment made under the DAO&rsquo;s own frozen criteria.
          </p>
          <div className="row" style={{ marginTop: "1.75rem", gap: "0.75rem" }}>
            <Link className="btn btn-primary" to="/cases">
              Browse amendment cases
            </Link>
            <Link className="btn" to="/methodology">
              How judgment works
            </Link>
          </div>
        </div>
      </section>

      <div className="page stack-loose">
        <section className="stack">
          <div>
            <p className="eyebrow">The problem</p>
            <h2>Parameter changes get approved on vibes</h2>
          </div>
          <div className="grid grid-2">
            <p className="muted">
              Most DAO governance asks token holders to approve a treasury
              parameter change on the strength of a forum post. The proposal
              says costs went up. Perhaps it links a screenshot, a dashboard, a
              figure with no source. There is no standard for what counts as
              evidence, no test of whether the sources are independent, and no
              cost to proposing something unsupported. The vote measures
              attention, not merit.
            </p>
            <p className="muted">
              A deterministic contract cannot close that gap. It can count votes
              and check numbers, but it cannot read a vendor quote and judge
              whether it supports the claim being made, whether two cited
              sources are actually the same organisation, or whether a proposed
              increase is proportionate to the need demonstrated. That judgment
              is the missing piece, and it is what GenLayer supplies.
            </p>
          </div>
        </section>

        <section className="stack">
          <div>
            <p className="eyebrow">The shape of it</p>
            <h2>An amendment becomes a case</h2>
          </div>
          <Pipeline steps={LIFECYCLE} />
          <div className="grid grid-3">
            <Card title="Frozen rules">
              <p className="small muted" style={{ marginBottom: 0 }}>
                A case snapshots the policy, the criteria, the evidence
                requirements and the treasury address the moment it opens.
                Nothing that happens later can change the rules it is judged
                under.
              </p>
            </Card>
            <Card title="Evidence, then silence">
              <p className="small muted" style={{ marginBottom: 0 }}>
                Sources are submitted, then frozen. Validators fetch each one
                on-chain and must agree on the exact text before it reaches the
                adjudicator. After the freeze, nothing can be added.
              </p>
            </Card>
            <Card title="A bond, not a bet">
              <p className="small muted" style={{ marginBottom: 0 }}>
                The proposer locks real native GEN. Accepted and invalid cases
                are refunded; a substantive rejection forfeits the bond to the
                DAO treasury. It is accountability, not a wager on an outcome.
              </p>
            </Card>
          </div>
        </section>

        <section className="stack">
          <div>
            <p className="eyebrow">What is different here</p>
            <h2>The contract decides, never the model</h2>
          </div>
          <p className="muted">
            The adjudicator grades eight semantic dimensions and returns strict
            JSON. The contract validates that output against an exact schema and
            vocabulary, rejects anything malformed, and then computes the
            decision itself from the criteria the DAO froze. Model uncertainty
            can never become an <code>INVALID</code> verdict, and a model saying
            &ldquo;accept&rdquo; cannot override a failed gate. Consensus decides
            whether a verdict is admissible; the contract decides what it means.
          </p>
          <p className="muted">
            The protocol is designed to reject plausible-looking amendments that
            are not actually supported. That is the feature, not a failure mode.
          </p>
        </section>

        {config.data && (
          <section className="stack">
            <div>
              <p className="eyebrow">Live protocol state</p>
              <h2>Read from the deployed contract</h2>
            </div>
            <Card>
              <DataList
                rows={[
                  ["Policies minted", String(config.data.policy_count)],
                  ["Amendment cases", String(config.data.case_count)],
                  ["Evidence records", String(config.data.evidence_count)],
                  ["Challenges", String(config.data.challenge_count)],
                  [
                    "Protocol state",
                    config.data.paused ? "Paused" : "Accepting new cases",
                  ],
                ]}
              />
            </Card>
            <p className="small faint">
              Counts come from <code>get_config()</code>. Nothing on this site is
              seeded, mocked or illustrative.
            </p>
          </section>
        )}
      </div>
    </>
  );
}
