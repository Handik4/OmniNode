"use client";

import { Html, Line, OrbitControls, Stars } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";
import type { TransactionHash } from "genlayer-js/types";
import {
  ArrowDown,
  Box,
  Check,
  Cpu,
  Database,
  ArrowUpRight,
  Gauge,
  LoaderCircle,
  Network,
  Radio,
  Server,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { Group } from "three";
import type { EIP1193Provider } from "viem";

const CONTRACT_ADDRESS = "0xA139A785518eeA23912d8632278634505f732f76";
const MINIMUM_STAKE_WEI = 10_000_000_000_000_000n;
const VALID_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;

const STUDIONET_CHAIN_ID = `0x${studionet.id.toString(16)}`;

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

function getEthereumProvider() {
  return window.ethereum;
}

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function toWei(value: string) {
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(normalized)) {
    throw new Error("Enter a valid GEN amount with up to 18 decimal places.");
  }
  const [whole, fraction = ""] = normalized.split(".");
  const amount = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
  if (amount === 0n) throw new Error("Price per epoch must be greater than zero.");
  return amount;
}

async function digestText(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function buildRegistrationMetadata(capacity: string, resourceType: string, walletAddress: string) {
  const capacityValue = Number(capacity);
  if (!Number.isFinite(capacityValue) || capacityValue <= 0) {
    throw new Error("Capacity must be greater than zero.");
  }
  const evidence = {
    capacity: capacityValue,
    observed_at: new Date().toISOString(),
    operator: walletAddress,
    resource_type: resourceType,
    status: "ACTIVE",
    unit: "capacity-units",
  };
  const canonicalEvidence = JSON.stringify(evidence, Object.keys(evidence).sort());
  return {
    capabilityProfile: canonicalEvidence,
    evidence: canonicalEvidence,
    telemetryUrl: "https://telemetry.omninode.network/v1/provider/" + walletAddress.toLowerCase(),
  };
}

function validateRegistrationId(value: string, label: string) {
  const normalized = value.trim();
  if (!VALID_ID.test(normalized)) {
    throw new Error(`${label} may contain only letters, numbers, periods, underscores, and internal hyphens.`);
  }
  return normalized;
}

function getTransactionHash(value: unknown): TransactionHash {
  if (typeof value === "string") return value as TransactionHash;
  if (value && typeof value === "object") {
    const result = value as { hash?: unknown; txId?: unknown };
    if (typeof result.hash === "string") return result.hash as TransactionHash;
    if (typeof result.txId === "string") return result.txId as TransactionHash;
  }
  throw new Error("The wallet did not return a transaction hash.");
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "The transaction could not be submitted.";
}

async function ensureStudionet(provider: EIP1193Provider) {
  const currentChainId = await provider.request({ method: "eth_chainId" });
  if (currentChainId === STUDIONET_CHAIN_ID) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: STUDIONET_CHAIN_ID }],
    });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: STUDIONET_CHAIN_ID,
          chainName: studionet.name,
          nativeCurrency: studionet.nativeCurrency,
          rpcUrls: [...studionet.rpcUrls.default.http],
          blockExplorerUrls: studionet.blockExplorers?.default.url ? [studionet.blockExplorers.default.url] : undefined,
        },
      ],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: STUDIONET_CHAIN_ID }],
    });
  }
}

const featurePanels = [
  {
    title: "Resource Market",
    description: "Browse verified compute, bandwidth, and storage capacity across active providers.",
    icon: Network,
    metric: "3 resource classes",
    accent: "text-cyan-300",
  },
  {
    title: "Provider Dashboard",
    description: "Register infrastructure, publish evidence, and monitor consensus-backed reliability.",
    icon: Server,
    metric: "Evidence verified",
    accent: "text-lime-300",
  },
  {
    title: "Consumer Requests",
    description: "Create escrowed requests and track each route from evaluation through finality.",
    icon: Radio,
    metric: "Finalized routing",
    accent: "text-amber-300",
  },
] as const;

const faqItems = [
  {
    question: "What is OmniNode?",
    answer:
      "OmniNode is a Universal DePIN Router. It connects consumers to available compute, bandwidth, and storage providers, then uses GenLayer AI Consensus to make routing decisions without a centralized orchestrator.",
  },
  {
    question: "How does AI Consensus verify nodes?",
    answer:
      "Providers publish capability profiles and time-bound evidence. GenLayer validators independently evaluate that evidence against the declared resource type, compare results through AI Consensus, and record a finalized node status and reliability signal.",
  },
  {
    question: "What resources are supported?",
    answer:
      "The market supports three resource classes: Compute for workloads and processing, Bandwidth for network delivery, and Storage for durable capacity. Each provider declares its resource type, region, capacity, price, and telemetry endpoint.",
  },
  {
    question: "How is escrow handled?",
    answer:
      "Consumers lock GEN when creating a request. The contract tracks escrow, provider credits, and consumer credits separately, so routing and settlement can release the right balance only after the relevant lifecycle decision is finalized.",
  },
] as const;

function RoutingField() {
  const field = useRef<Group>(null);

  useFrame(({ clock }) => {
    if (!field.current) return;
    field.current.rotation.y = Math.sin(clock.elapsedTime * 0.18) * 0.16;
    field.current.rotation.x = Math.cos(clock.elapsedTime * 0.14) * 0.04;
  });

  const nodes = [
    [-3.8, 1.8, -1.2],
    [-4.2, -1.6, 0.4],
    [3.8, 1.5, -0.6],
    [4.3, -1.7, -1.1],
    [0, 3.1, -1.8],
    [0, -3, -1.2],
  ] as [number, number, number][];

  return (
    <group ref={field}>
      {nodes.map((position, index) => (
        <group key={position.join("-")} position={position}>
          <mesh>
            <icosahedronGeometry args={[index % 2 === 0 ? 0.2 : 0.14, 1]} />
            <meshStandardMaterial
              color={index % 3 === 0 ? "#9ef0ff" : index % 3 === 1 ? "#b7ff69" : "#ffcc66"}
              emissive={index % 3 === 0 ? "#227a8d" : index % 3 === 1 ? "#4f7723" : "#8c5c16"}
              emissiveIntensity={2.2}
            />
          </mesh>
          <pointLight color="#8feaff" intensity={1.4} distance={2.8} />
        </group>
      ))}

      {nodes.map((position) => (
        <Line
          key={`line-${position.join("-")}`}
          points={[[0, 0, 0], position]}
          color="#315273"
          lineWidth={0.7}
          transparent
          opacity={0.6}
        />
      ))}

      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.55, 0.012, 8, 100]} />
        <meshBasicMaterial color="#78dfff" transparent opacity={0.55} />
      </mesh>
      <mesh rotation={[Math.PI / 2.6, 0.5, 0]}>
        <torusGeometry args={[2.25, 0.008, 8, 100]} />
        <meshBasicMaterial color="#86a9d6" transparent opacity={0.28} />
      </mesh>

      <Html transform center distanceFactor={6.8} position={[0, 0, 0.3]}>
        <article className="hero-card w-[min(84vw,620px)]" aria-label="OmniNode introduction">
          <div className="mb-7 flex items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <span className="signal-mark" aria-hidden="true">
                <Box size={17} strokeWidth={1.8} />
              </span>
              <span className="font-mono text-[11px] uppercase text-slate-300">OmniNode routing plane</span>
            </div>
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase text-cyan-100">
              <span className="h-1.5 w-1.5 bg-lime-300 shadow-[0_0_12px_#bef264]" />
              Consensus online
            </span>
          </div>
          <h1 className="font-display text-4xl font-medium leading-[1.02] text-white sm:text-6xl">
            OmniNode
          </h1>
          <p className="mt-5 max-w-lg text-sm leading-7 text-slate-300 sm:text-base">
            OmniNode: Universal DePIN Router. Powered by GenLayer AI Consensus. Seamlessly routing Compute, Bandwidth, and Storage.
          </p>
          <div className="mt-8 grid grid-cols-3 border-t border-white/10 pt-5 font-mono text-[10px] uppercase text-slate-400">
            <span>Compute</span>
            <span className="text-center">Bandwidth</span>
            <span className="text-right">Storage</span>
          </div>
        </article>
      </Html>
    </group>
  );
}

function Hero() {
  return (
    <section className="relative h-screen min-h-[620px] overflow-hidden bg-[#03070c]" aria-label="OmniNode overview">
      <Canvas
        className="absolute inset-0"
        camera={{ position: [0, 0, 10], fov: 48 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={["#03070c"]} />
        <fog attach="fog" args={["#03070c", 9, 22]} />
        <ambientLight intensity={0.45} />
        <directionalLight position={[4, 8, 5]} intensity={1.3} color="#d7f5ff" />
        <Stars radius={45} depth={18} count={950} factor={2} saturation={0.2} fade speed={0.25} />
        <RoutingField />
        <OrbitControls
          enablePan={false}
          enableZoom={false}
          minPolarAngle={Math.PI / 2.5}
          maxPolarAngle={Math.PI / 1.7}
          rotateSpeed={0.35}
        />
      </Canvas>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between px-5 py-5 sm:px-10 sm:py-8">
        <span className="font-display text-sm font-semibold text-white">OMNINODE</span>
        <span className="font-mono text-[10px] uppercase text-slate-500">GenLayer Studionet</span>
      </div>

      <a
        href="#dashboard"
        className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 font-mono text-[10px] uppercase text-slate-400 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
      >
        Open control surface
        <ArrowDown size={14} aria-hidden="true" />
      </a>
    </section>
  );
}

function About() {
  return (
    <section id="about" className="relative overflow-hidden border-y border-slate-800 bg-[#060b11] px-5 py-20 text-slate-100 sm:px-10 lg:px-16 lg:py-28">
      <div className="pointer-events-none absolute -right-24 top-16 h-72 w-72 rounded-full bg-cyan-300/5 blur-3xl" aria-hidden="true" />
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-12 lg:grid-cols-[0.78fr_1.22fr] lg:gap-20">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-cyan-300">About OmniNode</p>
            <h2 className="mt-5 max-w-md font-display text-3xl font-medium leading-tight text-white sm:text-5xl">
              Infrastructure should route itself.
            </h2>
            <a
              href="#faq"
              className="mt-8 inline-flex items-center gap-2 border-b border-cyan-300/50 pb-2 font-mono text-[10px] uppercase text-cyan-100 transition-colors hover:border-cyan-200 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-4 focus-visible:ring-offset-[#060b11]"
            >
              Read the operating model
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </div>

          <div className="relative">
            <div className="absolute -left-5 top-1 h-full border-l border-dashed border-slate-700 lg:-left-10" aria-hidden="true" />
            <p className="max-w-3xl text-xl leading-9 text-slate-200 sm:text-2xl sm:leading-10">
              OmniNode is a Universal DePIN Router that uses GenLayer AI Consensus to intelligently evaluate, route, and switch decentralized resources.
            </p>
            <p className="mt-7 max-w-2xl text-sm leading-7 text-slate-400 sm:text-base">
              Instead of depending on a centralized coordinator, OmniNode turns provider evidence into a shared decision. Compute, Bandwidth, and Storage nodes declare what they can offer; consensus-backed evaluation determines which resource is eligible, reliable, and worth routing to.
            </p>

            <div className="mt-10 grid gap-px border border-slate-800 bg-slate-800 sm:grid-cols-3">
              <div className="bg-[#0a1017] p-5">
                <p className="font-mono text-[10px] uppercase text-cyan-300">Evaluate</p>
                <p className="mt-3 text-sm leading-6 text-slate-400">Compare declarations with fresh provider evidence.</p>
              </div>
              <div className="bg-[#0a1017] p-5">
                <p className="font-mono text-[10px] uppercase text-lime-300">Route</p>
                <p className="mt-3 text-sm leading-6 text-slate-400">Select the best eligible resource for each request.</p>
              </div>
              <div className="bg-[#0a1017] p-5">
                <p className="font-mono text-[10px] uppercase text-amber-300">Switch</p>
                <p className="mt-3 text-sm leading-6 text-slate-400">Move away from degraded capacity with a reasoned decision.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FAQ() {
  return (
    <section id="faq" className="bg-[#080d13] px-5 py-20 text-slate-100 sm:px-10 lg:px-16 lg:py-28">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col justify-between gap-5 border-b border-slate-800 pb-8 sm:flex-row sm:items-end">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-lime-300">Frequently asked questions</p>
            <h2 className="mt-4 font-display text-3xl font-medium text-white sm:text-5xl">The routing layer, plainly explained.</h2>
          </div>
          <p className="max-w-xs text-sm leading-6 text-slate-500">A short field guide for judges, providers, and resource consumers.</p>
        </header>

        <div className="mt-8 grid gap-px border border-slate-800 bg-slate-800 md:grid-cols-2">
          {faqItems.map(({ question, answer }, index) => (
            <details key={question} className="group bg-[#0a1017] p-6 transition-colors open:bg-[#0d151e] sm:p-8">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-4 focus-visible:ring-offset-[#0a1017] [&::-webkit-details-marker]:hidden">
                <span className="flex gap-4">
                  <span className="font-mono text-[10px] text-slate-600">0{index + 1}</span>
                  <span className="font-display text-lg text-white">{question}</span>
                </span>
                <span className="relative mt-1 h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true">
                  <span className="absolute left-0 top-1/2 h-px w-4 bg-current" />
                  <span className="absolute left-1/2 top-0 h-4 w-px bg-current transition-transform group-open:rotate-90" />
                </span>
              </summary>
              <p className="ml-8 mt-5 max-w-xl border-l border-slate-700 pl-4 text-sm leading-7 text-slate-400">{answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Dashboard() {
  const [walletAddress, setWalletAddress] = useState("");
  const [nodeId, setNodeId] = useState("node-main");
  const [resourceType, setResourceType] = useState("COMPUTE");
  const [capacity, setCapacity] = useState("16");
  const [region, setRegion] = useState("global");
  const [price, setPrice] = useState("0.01");
  const [transactionState, setTransactionState] = useState<"IDLE" | "PENDING" | "FINALIZED" | "ERROR">("IDLE");
  const [transactionHash, setTransactionHash] = useState("");
  const [feedback, setFeedback] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    const provider = getEthereumProvider();
    if (!provider?.on) return;

    const handleAccountsChanged = (accounts: readonly `0x${string}`[]) => {
      setWalletAddress(accounts[0] ?? "");
      if (accounts.length === 0) {
        setFeedback("Connect a wallet to register infrastructure.");
      }
    };

    provider.on("accountsChanged", handleAccountsChanged);
    return () => provider.removeListener?.("accountsChanged", handleAccountsChanged);
  }, []);

  async function connectWallet() {
    const provider = getEthereumProvider();
    if (!provider) {
      setFeedback("Install a browser wallet with window.ethereum enabled.");
      return;
    }

    setIsConnecting(true);
    setFeedback("");
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const address = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : "";
      if (!address) throw new Error("The wallet did not return an account.");
      await ensureStudionet(provider);
      setWalletAddress(address);
      setFeedback("Wallet connected on Studionet. Ready to publish provider capacity.");
    } catch (error) {
      setFeedback(getErrorMessage(error));
    } finally {
      setIsConnecting(false);
    }
  }

  async function registerNode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!walletAddress) {
      await connectWallet();
      return;
    }
    const provider = getEthereumProvider();
    if (!provider) {
      setFeedback("Connect a browser wallet before registering a node.");
      return;
    }

    setTransactionState("PENDING");
    setTransactionHash("");
    setFeedback("Awaiting wallet approval.");

    try {
      await ensureStudionet(provider);
      const normalizedNodeId = validateRegistrationId(nodeId, "Node ID");
      const normalizedRegion = validateRegistrationId(region, "Region");
      const metadata = buildRegistrationMetadata(capacity, resourceType, walletAddress);
      const evidenceDigest = await digestText(metadata.evidence);
      const client = createClient({
        account: walletAddress as `0x${string}`,
        chain: studionet,
        provider,
      });
      const hash = getTransactionHash(
        await client.writeContract({
          address: CONTRACT_ADDRESS as `0x${string}`,
          functionName: "register_node",
          args: [
            normalizedNodeId,
            walletAddress,
            resourceType,
            normalizedRegion,
            metadata.capabilityProfile,
            metadata.telemetryUrl,
            evidenceDigest,
            toWei(price),
          ],
          value: MINIMUM_STAKE_WEI,
        }),
      );
      setTransactionHash(hash);
      setFeedback("Transaction submitted. Waiting for finality.");

      const receipt = await client.waitForTransactionReceipt({
        hash,
        interval: 3000,
        retries: 40,
        status: TransactionStatus.FINALIZED,
      });
      const executionResult = receipt.txExecutionResultName ?? (receipt.txExecutionResult === 1 ? ExecutionResult.FINISHED_WITH_RETURN : undefined);
      if (executionResult !== ExecutionResult.FINISHED_WITH_RETURN) {
        throw new Error(`Registration finalized with ${executionResult ?? "an unknown execution result"}.`);
      }
      setTransactionState("FINALIZED");
      setFeedback("Node registration finalized successfully.");
    } catch (error) {
      setTransactionState("ERROR");
      setFeedback(getErrorMessage(error));
    }
  }

  const isSubmitting = transactionState === "PENDING";

  return (
    <section id="dashboard" className="min-h-screen scroll-mt-0 bg-[#080d13] px-5 py-16 text-slate-100 sm:px-10 lg:px-16 lg:py-24">
      <div className="mx-auto max-w-7xl">
        <header className="border-b border-slate-800 pb-10">
          <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
            <div>
              <p className="font-mono text-[11px] uppercase text-cyan-300">Application dashboard</p>
              <h2 className="mt-4 max-w-2xl font-display text-3xl font-medium text-white sm:text-5xl">
                Route infrastructure with evidence, not assumptions.
              </h2>
            </div>
            <div className="flex items-center gap-3 border-l-2 border-lime-300 bg-[#0c131b] px-4 py-3">
              <ShieldCheck className="text-lime-300" size={18} aria-hidden="true" />
              <div>
                <p className="font-mono text-[9px] uppercase text-slate-500">Network state</p>
                <p className="mt-1 text-xs text-slate-200">Studionet available</p>
              </div>
            </div>
          </div>
        </header>

        <div className="mt-8 grid gap-px overflow-hidden border border-slate-800 bg-slate-800 lg:grid-cols-3">
          {featurePanels.map(({ title, description, icon: Icon, metric, accent }) => (
            <article key={title} className="group min-h-72 bg-[#0a1017] p-6 transition-colors hover:bg-[#0d151e] sm:p-8">
              <div className="flex items-start justify-between">
                <Icon size={24} strokeWidth={1.5} className={accent} aria-hidden="true" />
                <Gauge size={16} className="text-slate-700 transition-colors group-hover:text-slate-500" aria-hidden="true" />
              </div>
              <h3 className="mt-16 font-display text-xl font-medium text-white">{title}</h3>
              <p className="mt-3 max-w-sm text-sm leading-6 text-slate-400">{description}</p>
              <p className="mt-8 border-t border-slate-800 pt-4 font-mono text-[10px] uppercase text-slate-500">{metric}</p>
            </article>
          ))}
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1.4fr_0.6fr]">
          <article className="border border-slate-800 bg-[#0a1017] p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <Database size={18} className="text-cyan-300" aria-hidden="true" />
              <h3 className="font-display text-base text-white">Connected contract</h3>
            </div>
            <p className="mt-5 break-all font-mono text-xs leading-6 text-slate-400 sm:text-sm">{CONTRACT_ADDRESS}</p>
            <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3 border-t border-slate-800 pt-5 font-mono text-[10px] uppercase text-slate-500">
              <span>Network: Studionet</span>
              <span>Contract: OmniNodeMarket</span>
              <span>Status: Finalized</span>
            </div>
          </article>

          <aside className="border border-slate-800 bg-[#0a1017] p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <Cpu size={18} className="text-amber-300" aria-hidden="true" />
              <h3 className="font-display text-base text-white">Resource plane</h3>
            </div>
            <dl className="mt-6 space-y-4 text-sm">
              <div className="flex justify-between border-b border-slate-800 pb-3">
                <dt className="text-slate-500">Compute</dt>
                <dd className="text-slate-200">Ready</dd>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-3">
                <dt className="text-slate-500">Bandwidth</dt>
                <dd className="text-slate-200">Ready</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Storage</dt>
                <dd className="text-slate-200">Ready</dd>
              </div>
            </dl>
          </aside>
        </div>

        <article className="mt-8 border border-slate-800 bg-[#0a1017] p-6 sm:p-8">
          <div className="flex flex-col justify-between gap-5 border-b border-slate-800 pb-6 sm:flex-row sm:items-start">
            <div>
              <div className="flex items-center gap-3">
                <Server size={18} className="text-lime-300" aria-hidden="true" />
                <h3 className="font-display text-xl text-white">Register provider capacity</h3>
              </div>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
                Publish a node profile to the deployed OmniNode market. The connected wallet becomes the owner and payout address.
              </p>
            </div>
            <button
              type="button"
              onClick={connectWallet}
              disabled={isConnecting}
              className="inline-flex shrink-0 items-center justify-center gap-2 border border-cyan-300/50 px-4 py-3 font-mono text-[10px] uppercase text-cyan-100 transition-colors hover:bg-cyan-300/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-wait disabled:opacity-60"
            >
              {isConnecting ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <Wallet size={15} aria-hidden="true" />}
              {walletAddress ? shortenAddress(walletAddress) : "Connect wallet"}
            </button>
          </div>

          <form className="mt-7 grid gap-5 md:grid-cols-2 lg:grid-cols-4" onSubmit={registerNode}>
            <label className="block">
              <span className="font-mono text-[10px] uppercase text-slate-500">Node ID</span>
              <input
                value={nodeId}
                onChange={(event) => setNodeId(event.target.value)}
                maxLength={128}
                pattern="[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?"
                className="mt-2 w-full border border-slate-700 bg-[#070c12] px-3 py-3 text-sm text-white outline-none transition-colors focus:border-cyan-300"
                placeholder="node-main"
                required
              />
            </label>
            <label className="block">
              <span className="font-mono text-[10px] uppercase text-slate-500">Resource type</span>
              <select
                value={resourceType}
                onChange={(event) => setResourceType(event.target.value)}
                className="mt-2 w-full border border-slate-700 bg-[#070c12] px-3 py-3 text-sm text-white outline-none transition-colors focus:border-cyan-300"
              >
                <option value="COMPUTE">Compute</option>
                <option value="BANDWIDTH">Bandwidth</option>
                <option value="STORAGE">Storage</option>
              </select>
            </label>
            <label className="block">
              <span className="font-mono text-[10px] uppercase text-slate-500">Capacity units</span>
              <input
                type="number"
                min="1"
                step="any"
                value={capacity}
                onChange={(event) => setCapacity(event.target.value)}
                className="mt-2 w-full border border-slate-700 bg-[#070c12] px-3 py-3 text-sm text-white outline-none transition-colors focus:border-cyan-300"
                required
              />
            </label>
            <label className="block">
              <span className="font-mono text-[10px] uppercase text-slate-500">Region</span>
              <input
                value={region}
                onChange={(event) => setRegion(event.target.value)}
                maxLength={64}
                pattern="[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?"
                className="mt-2 w-full border border-slate-700 bg-[#070c12] px-3 py-3 text-sm text-white outline-none transition-colors focus:border-cyan-300"
                placeholder="global"
                required
              />
            </label>
            <label className="block md:col-span-2 lg:col-span-1">
              <span className="font-mono text-[10px] uppercase text-slate-500">Price per epoch (GEN)</span>
              <input
                inputMode="decimal"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                className="mt-2 w-full border border-slate-700 bg-[#070c12] px-3 py-3 text-sm text-white outline-none transition-colors focus:border-cyan-300"
                placeholder="0.01"
                required
              />
            </label>
            <div className="flex items-end md:col-span-2 lg:col-span-3">
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 bg-lime-300 px-5 font-mono text-[10px] uppercase text-[#071009] transition-colors hover:bg-lime-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-200 disabled:cursor-wait disabled:opacity-60"
              >
                {isSubmitting ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : transactionState === "FINALIZED" ? <Check size={15} aria-hidden="true" /> : <Server size={15} aria-hidden="true" />}
                {isSubmitting ? "Registering node" : transactionState === "FINALIZED" ? "Node registered" : "Register node"}
              </button>
            </div>
          </form>

          <div className="mt-6 flex flex-col gap-3 border-t border-slate-800 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3" role="status">
              <span className={`mt-0.5 inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-[9px] ${transactionState === "ERROR" ? "border-rose-400/40 text-rose-300" : transactionState === "FINALIZED" ? "border-lime-300/40 text-lime-300" : transactionState === "PENDING" ? "border-amber-300/40 text-amber-300" : "border-slate-700 text-slate-500"}`}>
                {transactionState === "PENDING" ? <LoaderCircle size={11} className="animate-spin" aria-hidden="true" /> : transactionState === "FINALIZED" ? <Check size={11} aria-hidden="true" /> : null}
                {transactionState}
              </span>
              <p className={`text-sm ${transactionState === "ERROR" ? "text-rose-300" : transactionState === "FINALIZED" ? "text-lime-300" : "text-slate-400"}`}>
                {feedback || "Minimum stake: 0.01 GEN. Registration remains pending until consensus finalizes."}
              </p>
            </div>
            {transactionHash ? (
              <a
                href={`${studionet.blockExplorers?.default.url}/tx/${transactionHash}`}
                target="_blank"
                rel="noreferrer"
                className="break-all font-mono text-[10px] uppercase text-cyan-300 hover:text-cyan-100"
              >
                {shortenAddress(transactionHash)}
              </a>
            ) : null}
          </div>
        </article>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <main>
      <Hero />
      <About />
      <FAQ />
      <Dashboard />
    </main>
  );
}
