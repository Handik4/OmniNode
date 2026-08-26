# OmniNode

## The Universal DePIN Router for an open resource economy

OmniNode is a consensus-backed routing and settlement layer for decentralized infrastructure. It intelligently evaluates provider evidence, routes requests to eligible resources, and creates a principled path for switching when service quality changes.

Compute, bandwidth, and storage networks should not need a centralized orchestrator to coordinate every decision. OmniNode uses GenLayer AI Consensus to turn heterogeneous provider data into auditable, shared decisions while keeping the actual resource payloads in the DePIN data plane.

> **Built for GenLayer:** OmniNode demonstrates how Intelligent Contracts can combine external evidence, AI-assisted judgment, deterministic policy checks, and on-chain escrow without asking a blockchain to carry the underlying workload.

## 🌟 Key Features

### 🧠 GenLayer AI Consensus

Provider evidence is treated as untrusted input and checked against declared capabilities, resource type, region, and freshness requirements. Independent GenLayer validator execution compares structured outputs and requires consensus on status, quality, scores, selected resources, evidence digests, and a telemetry freshness verdict.

### 🛰️ Fresh, Independently Authenticated Telemetry

OmniNode never trusts a provider's own word for its health. Every piece of verification and routing evidence must include a `telemetry` block sourced from a **neutral third-party monitor**, and the contract enforces this both deterministically and through AI Consensus:

- **Third-party origin:** `telemetry.source` must be `THIRD_PARTY_MONITOR`, `telemetry.self_reported` must be `false`, and `telemetry.authenticated` must be `true`.
- **Distinct monitor URL:** `telemetry.monitor_url` must be HTTPS and must differ from the provider's own self-reported telemetry URL, so a provider cannot attest to itself.
- **Signed attestation:** `telemetry.attestation` must be a non-empty authentication token bound to the observation.
- **Strict freshness:** `telemetry.observed_at` is a Unix timestamp that must be recent (within `EVIDENCE_MAX_AGE_SECONDS`, currently 300 seconds) and must not be in the future. Stale telemetry is rejected before ranking, and a node cannot be activated or routed to without a `FRESH` telemetry verdict agreed by the validators.

### 🌐 Universal DePIN Routing

One shared market model supports three resource classes:

- **Compute:** workloads, processing capacity, and execution environments.
- **Bandwidth:** network delivery, regional connectivity, and transfer capacity.
- **Storage:** durable capacity, availability, and data placement.

Requests can be matched against hard eligibility constraints before AI Consensus ranks the remaining candidates by capability, quality, reliability, cost, and switching risk.

### 🔐 Secure Escrow

Consumer funds are locked with the request and tracked by the Intelligent Contract. Provider credits, consumer credits, total locked value, and refundable value are represented explicitly, so an indexer or operator cannot unilaterally decide who gets paid.

### 🧾 Evidence-Backed State

Canonical JSON and SHA-256 evidence digests bind submitted observations to verification and route decisions. Finalized transaction state, decision revisions, reason codes, and evidence references create an auditable trail for providers and consumers.

### ⚡ Wallet-Native Provider Onboarding

The Next.js dashboard connects directly to a browser wallet, switches to GenLayer Studionet, and submits `register_node` to the deployed market contract. The interface displays transaction lifecycle states from pending submission through finalization and validates the execution result before reporting success.

## 🚀 Live Deployment

| Network | Contract | Address |
| --- | --- | --- |
| GenLayer Studionet | `OmniNodeMarket` | [`0x59c768Cc2b062aC0e4B67361917e3f998d42F7bF`](https://genlayer-explorer.vercel.app/contracts/0x59c768Cc2b062aC0e4B67361917e3f998d42F7bF) |

Deployment transaction: [`0x3ba1a275195f76b695299e92d2eb205e80bc70d81d3fe898782a8d7a2c637d89`](https://genlayer-explorer.vercel.app/tx/0x3ba1a275195f76b695299e92d2eb205e80bc70d81d3fe898782a8d7a2c637d89)

### Deployment Notes

- **Network:** GenLayer Studionet
- **Contract:** `OmniNodeMarket`
- **Minimum provider stake:** `0.01 GEN`
- **Minimum consumer escrow:** `0.001 GEN`
- **Provider registration state:** `UNVERIFIED` until evidence verification reaches a consensus-backed result
- **Transaction lifecycle:** `PENDING` → consensus processing → `FINALIZED`

The contract address above is the deployed market instance used by the frontend. Wallet writes are user-signed; private keys never enter the Next.js application.

## 🛠️ Tech Stack

| Layer | Technology | Role |
| --- | --- | --- |
| Frontend | Next.js 15, React 19, TypeScript | Landing page, dashboard, wallet interaction, and transaction feedback |
| Styling | Tailwind CSS | Responsive dark interface and operational UI primitives |
| 3D presentation | Three.js, `@react-three/fiber`, `@react-three/drei` | Interactive routing-field hero visualization |
| Wallet and chain client | `genlayer-js` 1.1.8 | GenLayer reads, writes, transaction polling, and Studionet integration |
| Intelligent Contract | Python on GenVM | Registry, evidence verification, route evaluation, state transitions, and escrow ledger |
| Contract validation | GenVM linter | Contract linting, schema validation, and type checking |

## 🏗️ Architecture Overview

OmniNode separates **decision authority** from **resource execution**.

### Control Plane

The GenLayer control plane is the source of truth for decisions that require evidence and judgment:

1. **Register:** a provider publishes a node ID, payout address, resource type, region, capability profile, telemetry URL, price, stake, and evidence digest.
2. **Verify:** authorized automation submits evidence. GenLayer nondeterministic execution evaluates the evidence, while validator logic checks structured agreement and digest integrity.
3. **Request:** a consumer creates a resource request with requirements, SLA policy, maximum price, duration, and escrow.
4. **Route:** eligible candidates are filtered deterministically. AI Consensus ranks the candidates and records a route decision, revision, scores, evidence digest, and reason codes.
5. **Settle:** `settle_request` finalizes the lifecycle. When AI Consensus selected a route, the locked escrow is converted into a provider credit for the winning node's payout address; when routing was inconclusive or the offer window expired, the escrow is safely released back to the consumer. Escrow can only ever become a provider credit or a consumer refund, and credit claims emit finalized transfers.

The web application is an interaction layer, not an authority layer. It can preview state and submit signed intent, but it cannot select a provider, override consensus, or release escrow on its own.

### Data Plane

The data plane remains outside GenLayer:

- Compute jobs execute on provider infrastructure.
- Bandwidth traffic moves through provider networks and adapters.
- Storage payloads remain in provider storage systems.
- Telemetry, probes, and activation receipts are published as evidence for the control plane.

This boundary keeps high-volume payloads and side-effectful infrastructure operations off-chain while preserving a verifiable decision record on-chain.

```text
Provider / Consumer Wallet
          |
          v
   Next.js Web Application
          |
          | signed writes and reads
          v
   OmniNodeMarket Contract  <---->  GenLayer Validator Set
          |                                  |
          | finalized decisions              | independent evidence evaluation
          v                                  v
   Control-Plane Automation  <--------  Evidence and Telemetry
          |
          | execute only finalized instructions
          v
   Provider-Specific Adapters
          |
          v
   Compute | Bandwidth | Storage Data Plane
```

## 💻 Getting Started

### Prerequisites

- Node.js 20 or newer
- npm
- A browser wallet for provider registration
- Access to GenLayer Studionet and sufficient GEN for transaction fees and stake

### Install and run the frontend

From the repository root:

```bash
cd apps/web
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in a browser.

### Production build

```bash
cd apps/web
npm run lint
npm run build
npm run start
```

## 🔁 Runnable End-to-End Workflow

A standalone client at [`scripts/run_workflow.ts`](scripts/run_workflow.ts) connects to the deployed `OmniNodeMarket` intelligent contract with `genlayer-js` and drives the entire resource lifecycle sequentially:

1. **Register** a provider node and lock provider stake.
2. **Verify** the node by submitting fresh, independently authenticated third-party telemetry evidence and reaching AI Consensus.
3. **Create** a consumer request with escrow.
4. **Route / match** the request through AI Consensus over the fresh telemetry.
5. **Read the outcome** (route decision, telemetry verdict, and escrow ledger) after consensus finalizes.
6. **Settle** by crediting the selected provider or safely releasing the escrow back to the consumer.
7. **Read** the resulting provider/consumer credit balances.

### Prerequisites for the workflow

- Node.js 20 or newer and npm.
- A funded GenLayer Studionet account private key. This account acts as the contract administrator/automation account for the run and also plays the demo provider and consumer roles, so it must hold enough GEN for the provider stake (`0.01 GEN`), the consumer escrow (`0.001 GEN`), and transaction fees.

### Run it

From the repository root:

```bash
# 1. Install workflow dependencies.
npm install

# 2. Configure the runner.
cp .env.example .env
# Edit .env and set OMNINODE_PRIVATE_KEY to your funded Studionet private key.

# 3. Run the full lifecycle end to end.
npm run workflow
```

By default the workflow **deploys a fresh `OmniNodeMarket` contract from source**, which guarantees the workflow account controls the `verify_node`, `evaluate_route`, and `settle_request` automation actions. To run against an already deployed contract you administer, set `OMNINODE_CONTRACT` in `.env`:

```bash
# Reuse an existing contract you administer instead of deploying a new one.
OMNINODE_CONTRACT=0xYourDeployedOmniNodeMarketAddress npm run workflow

# Force a fresh deployment even when OMNINODE_CONTRACT is set.
npm run workflow:deploy
```

The script logs every stage, waits for AI Consensus and finality on each transaction, and prints the finalized route decision, settlement outcome, and credit balances. Because telemetry freshness is strictly enforced (`observed_at` must be within 300 seconds), a full run is expected to complete inside the freshness window; if a run is unusually slow the freshness guard will safely release the escrow to the consumer instead of routing, which itself demonstrates the trust model.

## 💻 Connect a wallet

1. Open the dashboard at `#dashboard`.
2. Select **Connect wallet**.
3. Approve the wallet connection and switch to GenLayer Studionet when prompted.
4. Enter a node ID, resource type, capacity, region, and price per epoch.
5. Approve the `register_node` transaction with at least `0.01 GEN` attached.
6. Wait for the UI to report `FINALIZED` and a successful execution result.

## 📁 Repository Map

```text
.
├── apps/
│   └── web/
│       ├── app/
│       │   ├── page.tsx          # 3D landing page and provider dashboard
│       │   ├── globals.css       # Global visual system
│       │   └── layout.tsx        # Fonts and application metadata
│       └── package.json
├── contracts/
│   └── src/
│       └── omni_node_market.py   # GenLayer Intelligent Contract
├── scripts/
│   └── run_workflow.ts           # Standalone end-to-end lifecycle client
├── .env.example                  # Workflow configuration template
├── package.json                  # Root workflow scripts and dependencies
├── tsconfig.json                 # TypeScript config for the workflow script
├── ARCHITECTURE.md               # Detailed system blueprint
└── README.md
```

## 🧭 Contract Surface

The deployed `OmniNodeMarket` contract exposes the core protocol actions:

- `register_node`: publish provider capacity and lock provider stake.
- `create_request`: create a consumer request and lock escrow.
- `verify_node`: evaluate fresh third-party telemetry evidence through GenLayer consensus.
- `evaluate_route`: filter candidates and record a consensus-backed route decision.
- `settle_request`: finalize a request by crediting the selected provider or safely releasing escrow to the consumer.
- `cancel_request`: cancel an eligible request and credit the consumer.
- `claim_credit`: withdraw finalized provider or consumer credits.
- `get_node`, `get_request`, `get_route_decision`, `get_escrow`, `get_credit`: inspect protocol state.

## 🔭 Why This Matters

DePIN networks are good at supplying resources, but coordination remains fragmented. OmniNode provides a shared decision layer that is:

- **Universal:** one routing model across multiple resource types.
- **Evidence-driven:** provider claims are checked against hashed observations.
- **Consensus-backed:** no single orchestrator owns the final decision.
- **Economically explicit:** escrow and credits are represented in contract state.
- **Operationally practical:** resource traffic stays in the systems built to carry it.

OmniNode is the routing plane between decentralized capacity and the applications that need it.

## 📄 License

This project is provided for hackathon evaluation and demonstration purposes.
