/**
 * OmniNode end-to-end workflow.
 *
 * A standalone client that connects to the deployed OmniNodeMarket intelligent
 * contract with genlayer-js and drives the full resource lifecycle:
 *
 *   1. Register a provider node and lock provider stake.
 *   2. Submit fresh, independently authenticated third-party telemetry as
 *      verification evidence and reach AI Consensus on node status.
 *   3. Create a consumer request and lock escrow.
 *   4. Route / match the request through AI Consensus.
 *   5. Read the finalized outcome (route decision + escrow ledger).
 *   6. Execute settlement: credit the selected provider or safely release the
 *      escrow back to the consumer.
 *   7. Read the resulting credit balances.
 *
 * Usage:
 *   cp .env.example .env   # then edit .env
 *   npm install
 *   npm run workflow
 *
 * The workflow account acts as administrator/automation as well as the demo
 * provider and consumer. When no OMNINODE_CONTRACT is configured (or when
 * OMNINODE_DEPLOY=1), a fresh contract is deployed from contracts/src so the
 * account is guaranteed to control the verify/route/settle automation actions.
 */

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";
import type { TransactionHash } from "genlayer-js/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const CONTRACT_SOURCE_PATH = resolve(REPO_ROOT, "contracts/src/omni_node_market.py");
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const MIN_STAKE_WEI = 10n ** 16n; // 0.01 GEN
const MIN_ESCROW_WEI = 10n ** 15n; // 0.001 GEN
const PROVIDER_PRICE_WEI = 10n ** 15n; // 0.001 GEN per epoch
const MAX_PRICE_WEI = 5n * 10n ** 16n; // 0.05 GEN per epoch cap
const REQUEST_DURATION_SECONDS = 3600n;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

// --- Minimal .env loader (keeps the script dependency-light) ------------------

function loadDotEnv(): void {
  const envPath = resolve(REPO_ROOT, ".env");
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// --- Canonical JSON + digest (must mirror the contract's _canonical_json) -----

function canonicalize(value: Json): Json {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const out: { [key: string]: Json } = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

function canonicalJson(value: Json): string {
  return JSON.stringify(canonicalize(value));
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// --- Logging helpers ----------------------------------------------------------

function stringifyDeep(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, inner) => (typeof inner === "bigint" ? inner.toString() : inner),
    2,
  );
}

function stage(index: number, title: string): void {
  console.log(`\n=== Stage ${index}: ${title} ===`);
}

function info(message: string): void {
  console.log(`  - ${message}`);
}

// --- Client + transaction helpers ---------------------------------------------

type Client = ReturnType<typeof createClient>;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable ${name}. See .env.example.`);
  }
  return value.trim();
}

function toTransactionHash(result: unknown): TransactionHash {
  if (typeof result === "string") return result as TransactionHash;
  if (result && typeof result === "object" && "hash" in result) {
    return (result as { hash: TransactionHash }).hash;
  }
  return result as TransactionHash;
}

async function waitFinalized(client: Client, hash: TransactionHash, label: string) {
  info(`submitted ${label}: ${hash}`);
  info("waiting for AI Consensus and finality...");
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.FINALIZED,
    interval: 5000,
    retries: 80,
  });
  const executionResult =
    receipt.txExecutionResultName ??
    (receipt.txExecutionResult === 1 ? ExecutionResult.FINISHED_WITH_RETURN : undefined);
  if (executionResult !== ExecutionResult.FINISHED_WITH_RETURN) {
    throw new Error(`${label} finalized with ${executionResult ?? "an unknown execution result"}.`);
  }
  info(`${label} finalized.`);
  return receipt;
}

function extractDeployedAddress(receipt: Record<string, unknown>): string | undefined {
  const decoded = receipt["txDataDecoded"] as { contractAddress?: unknown } | undefined;
  const data = receipt["data"] as { contract_address?: unknown } | undefined;
  const candidates: unknown[] = [
    decoded?.contractAddress,
    data?.contract_address,
    receipt["to_address"],
    receipt["recipient"],
  ];
  for (const candidate of candidates) {
    if (
      typeof candidate === "string" &&
      /^0x[0-9a-fA-F]{40}$/.test(candidate) &&
      candidate.toLowerCase() !== ZERO_ADDRESS
    ) {
      return candidate;
    }
  }
  return undefined;
}

// --- Evidence construction ----------------------------------------------------

interface TelemetryEvidence {
  [key: string]: Json;
}

function buildTelemetryEvidence(
  nodeId: string,
  resourceType: string,
  region: string,
  providerTelemetryUrl: string,
): TelemetryEvidence {
  const observedAt = Math.floor(Date.now() / 1000);
  // A neutral third-party monitor URL that is deliberately distinct from the
  // provider's own self-reported telemetry endpoint.
  const monitorUrl = `https://monitor.omninode-observatory.net/attestations/${nodeId}`;
  const attestation = "0x" + sha256Hex(`${monitorUrl}|${observedAt}|${nodeId}`);
  return {
    node_id: nodeId,
    resource_type: resourceType,
    region,
    capacity: { unit: "vCPU", units: 128, available: 96 },
    metrics: { uptime_bps: 9985, latency_ms: 42, error_rate_bps: 12 },
    telemetry: {
      source: "THIRD_PARTY_MONITOR",
      monitor_id: "neutral-probe-eu-west-01",
      monitor_url: monitorUrl,
      observed_at: observedAt,
      attestation,
      authenticated: true,
      self_reported: false,
      probe_method: "ACTIVE_SYNTHETIC",
      provider_self_reported_url: providerTelemetryUrl,
    },
  };
}

// --- Main workflow ------------------------------------------------------------

async function main(): Promise<void> {
  loadDotEnv();

  const privateKey = requireEnv("OMNINODE_PRIVATE_KEY") as `0x${string}`;
  const resourceType = (process.env.OMNINODE_RESOURCE_TYPE || "COMPUTE").trim();
  const region = (process.env.OMNINODE_REGION || "us-east").trim();
  const forceDeploy = process.env.OMNINODE_DEPLOY === "1";
  const configuredContract = (process.env.OMNINODE_CONTRACT || "").trim();

  const account = createAccount(privateKey);
  const client = createClient({ account, chain: studionet });

  console.log("OmniNode end-to-end workflow");
  console.log(`  network : ${studionet.name} (chain id ${studionet.id})`);
  console.log(`  account : ${account.address}`);

  // --- Resolve or deploy the contract -----------------------------------------
  let contractAddress: string;
  if (configuredContract !== "" && !forceDeploy) {
    contractAddress = configuredContract;
    stage(0, "Using configured OmniNodeMarket contract");
    info(`address: ${contractAddress}`);
    info("note: the workflow account must be this contract's administrator/automation account.");
  } else {
    stage(0, "Deploying a fresh OmniNodeMarket contract");
    const code = readFileSync(CONTRACT_SOURCE_PATH, "utf8");
    const deployHash = toTransactionHash(await client.deployContract({ code, args: [] }));
    const receipt = await waitFinalized(client, deployHash, "contract deployment");
    const deployed = extractDeployedAddress(receipt as unknown as Record<string, unknown>);
    if (!deployed) {
      console.error("Could not read the deployed contract address from the receipt.");
      console.error("Receipt keys:", Object.keys(receipt).join(", "));
      throw new Error("Deployment succeeded but the contract address could not be resolved.");
    }
    contractAddress = deployed;
    info(`deployed OmniNodeMarket at: ${contractAddress}`);
  }

  const address = contractAddress as `0x${string}`;
  const runId = Date.now().toString(36);
  const nodeId = `omninode-demo-node-${runId}`;
  const requestId = `omninode-demo-request-${runId}`;
  const providerTelemetryUrl = `https://telemetry.${runId}.provider.omninode.example`;
  const capabilityProfile = `resource_type=${resourceType};region=${region};tier=standard`;

  const evidence = buildTelemetryEvidence(nodeId, resourceType, region, providerTelemetryUrl);
  const evidenceJson = canonicalJson(evidence as Json);
  const evidenceDigest = sha256Hex(evidenceJson);

  // --- Stage 1: register the provider node ------------------------------------
  stage(1, "Register provider node (locks provider stake)");
  info(`node_id: ${nodeId}`);
  info(`evidence_digest: ${evidenceDigest}`);
  const registerHash = toTransactionHash(
    await client.writeContract({
      address,
      functionName: "register_node",
      args: [
        nodeId,
        account.address,
        resourceType,
        region,
        capabilityProfile,
        providerTelemetryUrl,
        evidenceDigest,
        PROVIDER_PRICE_WEI,
      ],
      value: MIN_STAKE_WEI,
    }),
  );
  await waitFinalized(client, registerHash, "register_node");

  // --- Stage 2: submit fresh third-party telemetry and verify -----------------
  stage(2, "Submit fresh third-party telemetry evidence and verify node (AI Consensus)");
  info("telemetry.source: THIRD_PARTY_MONITOR (self_reported=false, authenticated=true)");
  info(`telemetry.monitor_url: ${(evidence.telemetry as Record<string, Json>).monitor_url}`);
  info(`telemetry.observed_at: ${(evidence.telemetry as Record<string, Json>).observed_at}`);
  const verifyHash = toTransactionHash(
    await client.writeContract({
      address,
      functionName: "verify_node",
      args: [nodeId, evidenceJson],
      value: 0n,
    }),
  );
  await waitFinalized(client, verifyHash, "verify_node");
  const nodeAfterVerify = (await client.readContract({
    address,
    functionName: "get_node",
    args: [nodeId],
  })) as Record<string, unknown>;
  const nodeStatus = String(nodeAfterVerify["status"]);
  info(`consensus node status: ${nodeStatus}`);
  info(`consensus reliability_bps: ${String(nodeAfterVerify["reliability_bps"])}`);
  if (nodeStatus !== "ACTIVE") {
    info("node was not activated; routing will be inconclusive and escrow will be released.");
  }

  // --- Stage 3: create the consumer request (locks escrow) --------------------
  stage(3, "Create consumer request (locks escrow)");
  info(`request_id: ${requestId}`);
  const createHash = toTransactionHash(
    await client.writeContract({
      address,
      functionName: "create_request",
      args: [
        requestId,
        resourceType,
        region,
        `Need ${resourceType} capacity in ${region} with high availability.`,
        "uptime_bps>=9900;max_latency_ms=120;fresh_third_party_telemetry=required",
        MAX_PRICE_WEI,
        REQUEST_DURATION_SECONDS,
      ],
      value: MIN_ESCROW_WEI,
    }),
  );
  await waitFinalized(client, createHash, "create_request");

  // --- Stage 4: route / match the request through AI Consensus ----------------
  stage(4, "Route / match the request (AI Consensus over fresh telemetry)");
  const evidenceBundle: Json = { [nodeId]: evidence as Json };
  const evidenceBundleJson = canonicalJson(evidenceBundle);
  const routeHash = toTransactionHash(
    await client.writeContract({
      address,
      functionName: "evaluate_route",
      args: [requestId, [nodeId], evidenceBundleJson],
      value: 0n,
    }),
  );
  await waitFinalized(client, routeHash, "evaluate_route");

  // --- Stage 5: read the finalized outcome ------------------------------------
  stage(5, "Read finalized outcome (route decision + escrow ledger)");
  const decision = (await client.readContract({
    address,
    functionName: "get_route_decision",
    args: [requestId],
  })) as Record<string, unknown>;
  const requestAfterRoute = (await client.readContract({
    address,
    functionName: "get_request",
    args: [requestId],
  })) as Record<string, unknown>;
  info(`route action: ${String(decision["action"])}`);
  info(`quality_class: ${String(decision["quality_class"])}`);
  info(`telemetry_verdict: ${String(decision["telemetry_verdict"] ?? "n/a")}`);
  info(`selected_node_id: ${String(decision["selected_node_id"]) || "(none)"}`);
  info(`total_score_bps: ${String(decision["total_score_bps"])}`);
  info(`request status: ${String(requestAfterRoute["status"])}`);
  console.log("  route decision:\n" + stringifyDeep(decision));

  // --- Stage 6: execute settlement --------------------------------------------
  stage(6, "Execute settlement (credit provider or safely release escrow)");
  const settleHash = toTransactionHash(
    await client.writeContract({
      address,
      functionName: "settle_request",
      args: [requestId],
      value: 0n,
    }),
  );
  await waitFinalized(client, settleHash, "settle_request");
  const requestAfterSettle = (await client.readContract({
    address,
    functionName: "get_request",
    args: [requestId],
  })) as Record<string, unknown>;
  const settledStatus = String(requestAfterSettle["status"]);
  const providerCredit = String(requestAfterSettle["provider_credit_wei"]);
  const consumerCredit = String(requestAfterSettle["consumer_credit_wei"]);
  info(`request status: ${settledStatus}`);
  if (providerCredit !== "0") {
    info(`provider credited: ${providerCredit} wei (escrow converted to provider credit)`);
  } else if (consumerCredit !== "0") {
    info(`escrow released to consumer: ${consumerCredit} wei (safe refund)`);
  }

  // --- Stage 7: read resulting credit balances --------------------------------
  stage(7, "Read resulting credit balances and escrow ledger");
  const providerBalance = await client.readContract({
    address,
    functionName: "get_credit",
    args: ["PROVIDER", account.address],
  });
  const consumerBalance = await client.readContract({
    address,
    functionName: "get_credit",
    args: ["CONSUMER", account.address],
  });
  const escrow = await client.readContract({ address, functionName: "get_escrow", args: [] });
  info(`provider credit balance: ${String(providerBalance)} wei`);
  info(`consumer credit balance: ${String(consumerBalance)} wei`);
  console.log("  escrow ledger:\n" + stringifyDeep(escrow));

  console.log("\nWorkflow complete. Full lifecycle executed against contract " + contractAddress);
}

main().catch((error) => {
  console.error("\nWorkflow failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
