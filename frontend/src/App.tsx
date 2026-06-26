import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PassportCard, type PassportState } from "./components/PassportCard";
import { Badge, Button, Card, Mono, cx } from "./components/primitives";
import {
  ArrowRight,
  Check,
  Coins,
  Cpu,
  ExternalLink,
  Fingerprint,
  Github,
  Key,
  Lock,
  ScanLine,
  ShieldCheck,
  X,
} from "./components/icons";
import { Mark, MarkChip, Wordmark } from "./components/Brand";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  authorizePayment,
  CONTRACTS,
  mintPassport,
  replaySpentProof,
  verifyOnChain,
  type MintedProof,
  type OnChainResult,
} from "./lib/passport";

const EXPLORER = (id: string) => `https://stellar.expert/explorer/testnet/contract/${id}`;
const REPO = "https://github.com/leocagli/open-stellar-passport";
const toStroops = (xlm: number) => BigInt(Math.round(xlm * 1e7)).toString();
const SPEND_CAP_MIN = 5;
const SPEND_CAP_MAX = 500;
const SPEND_CAP_STEP = 5;
const SPEND_CAP_INPUT_ID = "spend-cap";

interface PayResult {
  authorized: boolean;
  reason: string;
  amount: number;
}

export default function App() {
  const [minted, setMinted] = useState<MintedProof | null>(null);
  const [proving, setProving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyRes, setVerifyRes] = useState<OnChainResult | null>(null);
  const [cap, setCap] = useState(50);
  const [payRes, setPayRes] = useState<PayResult | null>(null);
  const [paying, setPaying] = useState(false);
  const [replay, setReplay] = useState<OnChainResult | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const addLog = (line: string) => setLog((l) => [...l, `${new Date().toLocaleTimeString()}  ${line}`]);

  const cardState: PassportState = verifyRes?.ok ? "verified" : minted ? "proven" : proving ? "proving" : "empty";

  async function doMint() {
    setProving(true);
    setMinted(null);
    setVerifyRes(null);
    setPayRes(null);
    addLog(`> generating witness + Groth16 proof client-side (cap ${cap} XLM)…`);
    try {
      const m = await mintPassport(toStroops(cap));
      setMinted(m);
      addLog(`+ proof generated in ${m.provingMs} ms · off-chain verify: ${m.offChainValid}`);
      addLog(`  agent #${m.agentId} · nullifier ${m.nullifierHash.slice(0, 20)}…`);
      toast.success("Proof generated", { description: `Agent #${m.agentId} · ${m.provingMs} ms, fully client-side` });
    } catch (e) {
      addLog(`! proving failed: ${String((e as Error).message)}`);
      toast.error("Proving failed", { description: String((e as Error).message) });
    } finally {
      setProving(false);
    }
  }

  async function doVerify() {
    if (!minted) return;
    setVerifying(true);
    addLog(`> submitting proof to AgentPassportValidator (BN254 pairing on-chain)…`);
    const r = await verifyOnChain(minted);
    setVerifyRes(r);
    addLog(r.ok ? `+ ON-CHAIN VERIFIED · attestation minted (ledger ${r.attestation?.ledger})` : `! rejected: ${r.error}`);
    if (r.ok) toast.success("Verified on-chain", { description: `BN254 pairing passed · ledger ${r.attestation?.ledger}` });
    else toast.error("Verification rejected", { description: r.error });
    setVerifying(false);
  }

  async function doPay(amount: number) {
    if (!minted) return;
    setPaying(true);
    addLog(`> agent #${minted.agentId} requests payment of ${amount} XLM (x402 gate)…`);
    const r = await authorizePayment(minted.agentId, toStroops(amount));
    setPayRes({ authorized: r.authorized, reason: r.reason, amount });
    addLog(r.authorized ? `+ APPROVED — ${r.reason}` : `x DENIED — ${r.reason}`);
    if (r.authorized) toast.success(`Payment authorized · ${amount} XLM`, { description: r.reason });
    else toast.error(`Payment denied · ${amount} XLM`, { description: r.reason });
    setPaying(false);
  }

  async function doReplay() {
    setReplaying(true);
    addLog(`> replaying a previously-spent passport (agent #42)…`);
    const r = await replaySpentProof();
    setReplay(r);
    addLog(r.ok ? `! unexpectedly accepted` : `+ chain rejected replay — ${r.error}`);
    if (!r.ok) toast.success("Replay blocked on-chain", { description: r.error });
    setReplaying(false);
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="min-h-screen">
        <Header />

      <main className="mx-auto max-w-[1180px] px-6">
        <div className="grid gap-x-12 gap-y-10 pt-12 lg:grid-cols-[1fr_minmax(380px,430px)]">
          {/* LEFT — hero + flow */}
          <div>
            <Hero />
            <div id="demo" className="mt-16 scroll-mt-24">
              <SectionLabel n="01">Live demo — prove &amp; verify, end to end</SectionLabel>
            </div>
            <div className="mt-5 space-y-4">
              <StepMint
                cap={cap}
                setCap={setCap}
                minted={minted}
                proving={proving}
                onMint={doMint}
              />
              <StepVerify minted={minted} verifying={verifying} verifyRes={verifyRes} onVerify={doVerify} />
              <StepPay cap={cap} verifyRes={verifyRes} paying={paying} payRes={payRes} onPay={doPay} />
              <StepReplay replaying={replaying} replay={replay} onReplay={doReplay} />
            </div>
          </div>

          {/* RIGHT — live credential + console */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <PassportCard
              state={cardState}
              agentId={minted?.agentId}
              spendCap={minted?.spendCap ?? toStroops(cap)}
              nullifier={minted?.nullifierHash}
              registryRoot={minted?.registryRoot}
              ledger={verifyRes?.attestation?.ledger}
            />
            <p className="mt-3 px-1 font-mono text-[11px] leading-relaxed text-faint">
              The proof is built in your browser. Owner key &amp; balance never leave this page — only the proof and
              its four public inputs are sent on-chain.
            </p>
            <div className="mt-5">
              <Console lines={log} />
            </div>
          </div>
        </div>

        <Threats />
        <HowItWorks />
        <TechSection />
        <Comparison />
      </main>
        <Footer />
        <Toaster position="bottom-right" />
      </div>
    </TooltipProvider>
  );
}

/* ----------------------------------------------------------------- chrome */

function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-black/[0.06] bg-ink-950/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1180px] items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">
          <Wordmark />
          <span className="ml-1 hidden items-center gap-1.5 rounded border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted sm:inline-flex">
            <span className="h-1 w-1 rounded-full bg-verified" /> testnet
          </span>
        </div>
        <nav className="flex items-center gap-5 text-sm">
          <a href="#demo" className="hidden font-medium text-fg/75 transition-colors hover:text-fg md:inline-block">
            Live demo
          </a>
          <a href="#tech" className="hidden font-medium text-fg/75 transition-colors hover:text-fg md:inline-block">
            Under the hood
          </a>
          <a
            href={REPO}
            target="_blank"
            className="inline-flex items-center gap-1.5 rounded bg-ink px-3.5 py-2 text-sm font-semibold text-white transition-transform hover:-translate-y-px"
          >
            <Github width={15} height={15} /> GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative">
      <Mark
        aria-hidden
        ticks
        accent="rgba(253,218,36,0.1)"
        width={280}
        height={280}
        className="pointer-events-none absolute -right-28 -top-40 -z-10 text-black/[0.025]"
      />
      <div className="inline-flex items-center gap-2 rounded border border-line bg-[#f8f8f8] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-violet" /> Stellar Hacks · Real-World ZK
      </div>
      <h1 className="mt-5 text-[3rem] font-extrabold leading-[1.02] tracking-[-0.038em] text-fg sm:text-[3.7rem]">
        Let AI agents pay
        <br />
        without trusting them<span className="text-violet">.</span>
      </h1>
      <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted">
        A single zero-knowledge proof — verified on-chain in Soroban — attests an agent is backed by a verified human,
        is Sybil-resistant, and is solvent for its spend cap. Identity and balance stay hidden.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <a
          href="#demo"
          className="inline-flex items-center gap-2 rounded bg-ink px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_24px_-10px_rgba(10,10,10,0.5)] transition-transform hover:-translate-y-px"
        >
          Try the live demo <ArrowRight width={16} height={16} />
        </a>
        <a
          href={EXPLORER(CONTRACTS.validator)}
          target="_blank"
          className="inline-flex items-center gap-1.5 font-mono text-xs text-muted transition-colors hover:text-fg"
        >
          live on testnet <ExternalLink width={13} height={13} />
        </a>
      </div>

      <ul className="mt-8 grid max-w-xl gap-px overflow-hidden rounded border border-black/[0.07] bg-black/[0.015] sm:grid-cols-1">
        <Claim icon={<Fingerprint width={17} height={17} />} title="Personhood, not PII">
          Merkle membership in an attested registry — no identity database to breach.
        </Claim>
        <Claim icon={<Lock width={17} height={17} />} title="One identity, one agent">
          A Poseidon2 nullifier blocks Sybil farms and replays, enforced on-chain.
        </Claim>
        <Claim icon={<Coins width={17} height={17} />} title="Solvent, balance hidden">
          Proof-of-funds shows <span className="text-fg/80">balance ≥ cap</span> without revealing the balance.
        </Claim>
      </ul>

      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[11px] text-faint">
        <span className="uppercase tracking-[0.18em]">Built on</span>
        {["Circom", "Groth16", "BN254", "Soroban", "Poseidon2", "ERC-8004"].map((t) => (
          <span key={t} className="text-muted">
            {t}
          </span>
        ))}
      </div>
    </section>
  );
}

function Claim({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3.5 px-4 py-3.5">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded bg-violet/10 text-violet-soft ring-1 ring-violet/15">
        {icon}
      </span>
      <div className="text-sm">
        <div className="font-medium text-fg">{title}</div>
        <div className="mt-0.5 text-muted">{children}</div>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ steps */

function StepShell({
  n,
  title,
  desc,
  children,
  active,
  done,
  locked,
  muted,
}: {
  n: number;
  title: string;
  desc: string;
  children: ReactNode;
  active?: boolean;
  done?: boolean;
  locked?: boolean;
  muted?: boolean;
}) {
  return (
    <Card
      className={cx(
        "!rounded !p-5 transition-all duration-300",
        locked && "opacity-45",
        active && "border-violet/25 bg-violet/[0.03]",
      )}
    >
      <div className="flex gap-4">
        <div className="flex flex-col items-center">
          <div
            className={cx(
              "grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-semibold ring-1 ring-inset transition-colors",
              done
                ? "bg-verified/15 text-verified ring-verified/40"
                : muted
                  ? "bg-black/5 text-faint ring-black/10"
                  : "bg-violet/15 text-violet-soft ring-violet/40",
            )}
          >
            {done ? <Check width={14} height={14} /> : n}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-[15px] font-semibold tracking-tight text-fg">{title}</h3>
          </div>
          <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{desc}</p>
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </Card>
  );
}

function StepMint({
  cap,
  setCap,
  minted,
  proving,
  onMint,
}: {
  cap: number;
  setCap: (n: number) => void;
  minted: MintedProof | null;
  proving: boolean;
  onMint: () => void;
}) {
  return (
    <StepShell n={1} title="Mint a passport" desc="Pick a spend cap. The owner secret and balance are generated and proven right here." active={!minted} done={!!minted}>
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-[200px] flex-1">
          <label htmlFor={SPEND_CAP_INPUT_ID} className="mb-2 flex items-center justify-between text-xs text-muted">
            <span>Spend cap</span>
            <span className="font-mono text-cyan">{cap} XLM</span>
          </label>
          <input
            id={SPEND_CAP_INPUT_ID}
            type="range"
            min={SPEND_CAP_MIN}
            max={SPEND_CAP_MAX}
            step={SPEND_CAP_STEP}
            value={cap}
            aria-label="Spend cap (XLM)"
            aria-valuemin={SPEND_CAP_MIN}
            aria-valuemax={SPEND_CAP_MAX}
            aria-valuenow={cap}
            aria-valuetext={`${cap} XLM`}
            onChange={(e) => setCap(Number(e.target.value))}
            className="w-full accent-[#0a0a0a]"
          />
        </div>
        <Button onClick={onMint} loading={proving}>
          {proving ? "Proving" : minted ? "Re-generate" : "Generate proof"}
          {!proving && <ArrowRight width={16} height={16} />}
        </Button>
      </div>

      <AnimatePresence>
        {minted && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-4 overflow-hidden">
            <div className="rounded border border-black/[0.07] bg-ink-950/50 p-3.5">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-cyan">
                  <Cpu width={13} height={13} /> Groth16 · {minted.provingMs} ms
                </span>
                <Badge tone={minted.offChainValid ? "verified" : "denied"}>
                  {minted.offChainValid ? <Check width={12} height={12} /> : <X width={12} height={12} />}
                  off-chain valid
                </Badge>
              </div>
              <div className="grid gap-1">
                <Mono label="π.a" value={minted.proofHex.a} />
                <Mono label="π.b" value={minted.proofHex.b} />
                <Mono label="π.c" value={minted.proofHex.c} />
              </div>
              <div className="mt-3 border-t border-black/[0.06] pt-3">
                <ProofDialog minted={minted} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </StepShell>
  );
}

function ProofDialog({ minted }: { minted: MintedProof }) {
  const inputs: [string, string][] = [
    ["registryRoot", minted.registryRoot],
    ["nullifierHash", minted.nullifierHash],
    ["agentId", minted.agentId],
    ["spendCap", minted.spendCap],
  ];
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-1.5 font-mono text-[11px] text-faint transition-colors hover:text-cyan">
          <ScanLine width={13} height={13} /> view full proof &amp; public inputs
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg border-black/10 bg-ink-900 text-fg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 tracking-tight">
            <Cpu width={16} height={16} className="text-violet-soft" /> Groth16 proof
          </DialogTitle>
          <DialogDescription className="font-mono text-[11px] text-faint">
            BN254 · proved in {minted.provingMs} ms, fully in-browser
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Section title="Proof (G1 · G2 · G1)">
            <Mono label="a" value={minted.proofHex.a} />
            <Mono label="b" value={minted.proofHex.b} />
            <Mono label="c" value={minted.proofHex.c} />
          </Section>
          <Section title="Public inputs">
            {inputs.map(([k, v]) => (
              <Mono key={k} label={k} value={v} />
            ))}
          </Section>
          <p className="rounded border border-violet/15 bg-violet/[0.05] p-3 text-xs text-muted">
            These four values + the proof are all that's sent on-chain. The owner key, balance, Merkle path and agent
            secret stay on this device.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded border border-black/[0.07] bg-ink-950/50 p-3.5">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-faint">{title}</div>
      <div className="grid gap-1">{children}</div>
    </div>
  );
}

function StepVerify({
  minted,
  verifying,
  verifyRes,
  onVerify,
}: {
  minted: MintedProof | null;
  verifying: boolean;
  verifyRes: OnChainResult | null;
  onVerify: () => void;
}) {
  return (
    <StepShell
      n={2}
      title="Verify on-chain"
      desc="The Soroban validator runs the BN254 pairing check and mints the attestation. Live — no wallet needed."
      active={!!minted && !verifyRes?.ok}
      done={!!verifyRes?.ok}
      locked={!minted}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onVerify} loading={verifying} disabled={!minted} variant={verifyRes?.ok ? "outline" : "primary"}>
          {verifyRes?.ok ? (
            <>
              <Check width={16} height={16} /> Verified
            </>
          ) : (
            <>
              <ScanLine width={16} height={16} /> Verify on Stellar
            </>
          )}
        </Button>
        <a
          href={EXPLORER(CONTRACTS.validator)}
          target="_blank"
          className="inline-flex items-center gap-1 font-mono text-[11px] text-faint transition-colors hover:text-cyan"
        >
          validator contract <ExternalLink width={12} height={12} />
        </a>
      </div>
      <AnimatePresence>
        {verifyRes && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
            {verifyRes.ok ? (
              <div className="rounded border border-verified/20 bg-verified/[0.05] p-3.5">
                <div className="flex items-center gap-2 text-sm font-semibold text-verified">
                  <Check width={16} height={16} /> Attestation minted on-chain
                </div>
                <div className="mt-2.5 grid gap-1">
                  <Mono label="nullifier" value={verifyRes.attestation!.nullifier} />
                  <Mono label="root" value={verifyRes.attestation!.registry_root} />
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded border border-denied/20 bg-denied/[0.05] p-3.5 text-sm text-denied">
                <X width={16} height={16} /> {verifyRes.error}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </StepShell>
  );
}

function StepPay({
  cap,
  verifyRes,
  paying,
  payRes,
  onPay,
}: {
  cap: number;
  verifyRes: OnChainResult | null;
  paying: boolean;
  payRes: PayResult | null;
  onPay: (n: number) => void;
}) {
  const within = Math.round(cap * 0.7);
  const over = Math.round(cap * 1.4);
  return (
    <StepShell
      n={3}
      title="Agent pays — x402 gate"
      desc="A payment settles only if the agent's proven (but hidden) cap covers the amount."
      active={!!verifyRes?.ok}
      locked={!verifyRes?.ok}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <Button variant="outline" onClick={() => onPay(within)} loading={paying} disabled={!verifyRes?.ok}>
          Pay {within} XLM
        </Button>
        <Button variant="outline" onClick={() => onPay(over)} loading={paying} disabled={!verifyRes?.ok}>
          Pay {over} XLM
        </Button>
        <span className="font-mono text-[11px] text-faint">cap {cap} XLM</span>
      </div>
      <AnimatePresence>
        {payRes && (
          <motion.div
            key={`${payRes.amount}-${payRes.authorized}`}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className={cx(
              "mt-4 flex items-center gap-3 rounded border p-3.5",
              payRes.authorized ? "border-verified/25 bg-verified/[0.05]" : "border-denied/25 bg-denied/[0.05]",
            )}
          >
            <span
              className={cx(
                "grid h-9 w-9 shrink-0 place-items-center rounded-full",
                payRes.authorized ? "bg-verified/15 text-verified" : "bg-denied/15 text-denied",
              )}
            >
              {payRes.authorized ? <Check width={18} height={18} /> : <X width={18} height={18} />}
            </span>
            <div>
              <div className={cx("text-sm font-semibold", payRes.authorized ? "text-verified" : "text-denied")}>
                {payRes.authorized ? "Authorized" : "Denied"} · {payRes.amount} XLM
              </div>
              <div className="text-xs text-muted">{payRes.reason} — balance never revealed.</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </StepShell>
  );
}

function StepReplay({ replaying, replay, onReplay }: { replaying: boolean; replay: OnChainResult | null; onReplay: () => void }) {
  return (
    <StepShell n={4} title="Anti-replay" desc="Each passport burns a one-time nullifier. A spent proof is rejected by the chain." muted>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="danger" onClick={onReplay} loading={replaying}>
          Replay a spent passport
        </Button>
        <AnimatePresence>
          {replay && (
            <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}>
              <Badge tone={replay.ok ? "denied" : "verified"}>
                {replay.ok ? <X width={12} height={12} /> : <ShieldCheck width={12} height={12} />}
                {replay.ok ? "accepted" : replay.error}
              </Badge>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </StepShell>
  );
}

/* ------------------------------------------------------------- console + */

function Console({ lines }: { lines: string[] }) {
  return (
    <div className="overflow-hidden rounded border border-black/[0.07] bg-ink-950/60">
      <div className="flex items-center gap-2 border-b border-black/[0.07] px-4 py-2.5">
        <Cpu width={13} height={13} className="text-faint" />
        <span className="font-mono text-[11px] tracking-wide text-faint">proof console</span>
        <span className="ml-auto font-mono text-[10px] text-faint">{lines.length} events</span>
      </div>
      <div className="h-40 overflow-y-auto p-3.5 font-mono text-[11px] leading-[1.7]">
        {lines.length === 0 ? (
          <span className="text-faint">// idle — mint a passport to begin</span>
        ) : (
          lines.map((l, i) => (
            <div
              key={i}
              className={cx(
                "whitespace-pre-wrap",
                l.includes("+") ? "text-verified" : l.includes("! ") || l.includes("x ") ? "text-denied" : "text-muted",
              )}
            >
              {l}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SectionLabel({ n, children, id }: { n: string; children: ReactNode; id?: string }) {
  return (
    <div id={id} className="flex items-center gap-3 scroll-mt-24">
      <span className="font-mono text-[11px] font-medium text-stellar-deep">{n}</span>
      <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-faint">{children}</span>
      <span className="h-px flex-1 bg-black/[0.07]" />
    </div>
  );
}

function Threats() {
  const items = [
    { icon: <Fingerprint width={18} height={18} />, t: "Identity loss", d: "No KYC honeypot — personhood is a Merkle proof; no PII ever touches the chain." },
    { icon: <Coins width={18} height={18} />, t: "Money loss", d: "A compromised agent can't exceed its proven cap; keys and full balance stay with the owner." },
    { icon: <Lock width={18} height={18} />, t: "Sybil farms", d: "A nullifier binds one identity to one agent; replays are rejected on-chain." },
  ];
  return (
    <section className="mt-24">
      <SectionLabel n="02">What it stops</SectionLabel>
      <div className="mt-6 grid gap-px overflow-hidden rounded border border-black/[0.07] bg-black/[0.05] sm:grid-cols-3">
        {items.map((i) => (
          <div key={i.t} className="bg-paper p-6">
            <span className="grid h-9 w-9 place-items-center rounded bg-ink text-stellar">{i.icon}</span>
            <div className="mt-4 text-[15px] font-semibold tracking-tight">{i.t}</div>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{i.d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { k: "Mint", icon: <Key width={18} height={18} />, d: "The human owner builds a proof from their registry membership, agent id and balance — entirely client-side." },
    { k: "Prove", icon: <Cpu width={18} height={18} />, d: "A Groth16 proof over BN254 attests personhood, a one-time nullifier and balance ≥ cap, revealing none of them." },
    { k: "Gate", icon: <ShieldCheck width={18} height={18} />, d: "Soroban verifies on-chain and mints an attestation; x402 settles a payment only within the proven cap." },
  ];
  return (
    <section className="mt-24">
      <SectionLabel n="03">How it works</SectionLabel>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {steps.map((s, i) => (
          <div key={s.k} className="relative rounded border border-black/[0.07] bg-paper p-6">
            <div className="flex items-center justify-between">
              <span className="grid h-10 w-10 place-items-center rounded bg-ink text-stellar">{s.icon}</span>
              <span className="font-mono text-[11px] text-faint">0{i + 1}</span>
            </div>
            <div className="mt-4 text-[15px] font-semibold tracking-tight">{s.k}</div>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.d}</p>
            {i < 2 && (
              <ArrowRight
                width={18}
                height={18}
                className="absolute -right-[11px] top-1/2 hidden -translate-y-1/2 text-faint md:block"
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function TechSection() {
  return (
    <section className="mt-24">
      <SectionLabel n="04" id="tech">
        Under the hood
      </SectionLabel>
      <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        {/* circuit */}
        <div className="rounded border border-black/[0.07] bg-paper p-6">
          <div className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <Cpu width={17} height={17} className="text-stellar-deep" /> agent_passport.circom
          </div>
          <p className="mt-1.5 text-sm text-muted">~9.6k constraints · proves in under a second in the browser.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <IoBox tone="private" title="Private — stays on device" items={["privateKey", "balance", "pathElements[20]", "pathIndices"]} />
            <IoBox tone="public" title="Public — sent on-chain" items={["registryRoot", "nullifierHash", "agentId", "spendCap"]} />
          </div>
          <div className="mt-4 space-y-1.5 font-mono text-[11px] text-muted">
            <div>publicKey = Poseidon2(privateKey)</div>
            <div>MerkleProof(publicKey, path) == registryRoot</div>
            <div>nullifierHash == Poseidon2(privateKey, agentId)</div>
            <div className="text-stellar-deep">balance ≥ spendCap</div>
          </div>
        </div>
        {/* contracts */}
        <div className="rounded border border-black/[0.07] bg-paper p-6">
          <div className="text-[15px] font-semibold tracking-tight">Deployed on Stellar testnet</div>
          <div className="mt-4 space-y-3">
            <ContractRow name="AgentPassportValidator" sub="stateful policy · nullifier store" id={CONTRACTS.validator} />
            <ContractRow name="CircomGroth16Verifier" sub="BN254 native precompile" id={CONTRACTS.verifier} />
          </div>
          <div className="mt-5 border-t border-black/[0.06] pt-4 text-xs leading-relaxed text-muted">
            Reuses{" "}
            <a className="text-fg underline-offset-2 hover:underline" href="https://github.com/NethermindEth/stellar-private-payments" target="_blank">
              Nethermind's verifier
            </a>{" "}
            and targets{" "}
            <a className="text-fg underline-offset-2 hover:underline" href="https://github.com/trionlabs/stellar-8004" target="_blank">
              ERC-8004 on Soroban
            </a>{" "}
            for agent identity.
          </div>
        </div>
      </div>
    </section>
  );
}

function IoBox({ tone, title, items }: { tone: "private" | "public"; title: string; items: string[] }) {
  const priv = tone === "private";
  return (
    <div className={cx("rounded border p-3.5", priv ? "border-black/[0.07] bg-black/[0.02]" : "border-stellar/40 bg-stellar/[0.08]")}>
      <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-faint">
        {priv ? <Lock width={12} height={12} /> : <ScanLine width={12} height={12} />}
        {title}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <span key={it} className="rounded-md bg-paper px-1.5 py-0.5 font-mono text-[11px] text-fg/80 ring-1 ring-black/[0.06]">
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}

function ContractRow({ name, sub, id }: { name: string; sub: string; id: string }) {
  return (
    <a
      href={EXPLORER(id)}
      target="_blank"
      className="group flex items-center justify-between rounded border border-black/[0.07] bg-black/[0.015] p-3 transition-colors hover:border-black/15 hover:bg-black/[0.03]"
    >
      <div className="min-w-0">
        <div className="text-sm font-medium">{name}</div>
        <div className="truncate font-mono text-[11px] text-faint">
          {id.slice(0, 10)}…{id.slice(-6)} · {sub}
        </div>
      </div>
      <ExternalLink width={15} height={15} className="shrink-0 text-faint transition-colors group-hover:text-fg" />
    </a>
  );
}

function Comparison() {
  const rows = [
    ["On Stellar / Soroban", false, true],
    ["Verified fully on-chain", false, true],
    ["Proof-of-funds spend cap", false, true],
    ["Anti-Sybil nullifier", true, true],
    ["No PII / no honeypot", false, true],
  ] as const;
  return (
    <section className="mt-24">
      <SectionLabel n="05">Why it's different</SectionLabel>
      <div className="mt-6 overflow-hidden rounded border border-black/[0.07]">
        <div className="grid grid-cols-[1fr_auto_auto] items-center bg-black/[0.03] px-5 py-3 text-[13px] font-medium">
          <span className="text-muted">Capability</span>
          <span className="w-28 text-center text-muted">Existing*</span>
          <span className="w-28 text-center">Agent Passport</span>
        </div>
        {rows.map(([label, other, ours], i) => (
          <div
            key={label}
            className={cx("grid grid-cols-[1fr_auto_auto] items-center px-5 py-3 text-sm", i % 2 ? "bg-paper" : "bg-black/[0.012]")}
          >
            <span className="text-fg/90">{label}</span>
            <span className="flex w-28 justify-center">{other ? <YesNo yes /> : <YesNo />}</span>
            <span className="flex w-28 justify-center">{ours ? <YesNo yes brand /> : <YesNo />}</span>
          </div>
        ))}
      </div>
      <p className="mt-2.5 font-mono text-[10.5px] text-faint">* SelfClaw, risotto-passport, World ID + AgentKit — EVM/Solana, personhood verified off-chain.</p>
    </section>
  );
}

function YesNo({ yes, brand }: { yes?: boolean; brand?: boolean }) {
  if (!yes) return <X width={15} height={15} className="text-faint" />;
  return (
    <span className={cx("grid h-5 w-5 place-items-center rounded-full", brand ? "bg-ink text-stellar" : "bg-verified/15 text-verified")}>
      <Check width={12} height={12} />
    </span>
  );
}

function Footer() {
  return (
    <footer className="mt-24 border-t border-black/[0.07] bg-black/[0.015]">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <MarkChip size={34} />
          <div>
            <div className="text-sm font-semibold tracking-tight">Agent Passport</div>
            <div className="font-mono text-[11px] text-faint">ZK-gated agent payments on Stellar</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px] text-muted">
          <a className="hover:text-fg" href="#demo">
            Live demo
          </a>
          <a className="hover:text-fg" href="#tech">
            Under the hood
          </a>
          <a className="inline-flex items-center gap-1 hover:text-fg" href={EXPLORER(CONTRACTS.validator)} target="_blank">
            Contract <ExternalLink width={11} height={11} />
          </a>
          <a className="inline-flex items-center gap-1 hover:text-fg" href={REPO} target="_blank">
            <Github width={12} height={12} /> GitHub
          </a>
        </div>
      </div>
      <div className="border-t border-black/[0.05] px-6 py-4">
        <div className="mx-auto max-w-[1180px] font-mono text-[10.5px] text-faint">
          research prototype · not audited · testnet only · built for Stellar Hacks: Real-World ZK
        </div>
      </div>
    </footer>
  );
}
