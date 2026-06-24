/* eslint-disable react-refresh/only-export-components */
import { useState, type ReactNode, type ButtonHTMLAttributes } from "react";

export function cx(...c: (string | false | undefined | null)[]) {
  return c.filter(Boolean).join(" ");
}

/** Short-form an address / big number: 1234…ABCD */
export function shorten(s: string, head = 6, tail = 6) {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

type Variant = "primary" | "ghost" | "outline" | "danger";
export function Button({
  variant = "primary",
  loading,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  const base =
    "relative inline-flex items-center justify-center gap-2 rounded px-4 py-2.5 text-sm font-semibold transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed select-none";
  const variants: Record<Variant, string> = {
    primary:
      "text-white bg-ink shadow-[0_8px_24px_-10px_rgba(10,10,10,0.5)] hover:-translate-y-px hover:shadow-[0_12px_28px_-10px_rgba(10,10,10,0.6)] active:translate-y-0",
    ghost: "text-fg/70 hover:text-fg hover:bg-black/[0.04]",
    outline: "text-fg border border-line hover:border-black/20 hover:bg-black/[0.03]",
    danger: "text-denied border border-denied/30 hover:bg-denied/[0.06]",
  };
  return (
    <button className={cx(base, variants[variant], className)} disabled={loading || props.disabled} {...props}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("animate-spin h-4 w-4", className)} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-20" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-90" d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

type Tone = "violet" | "cyan" | "verified" | "denied" | "amber" | "muted";
const toneCls: Record<Tone, string> = {
  violet: "text-violet-soft bg-violet/10 ring-violet/25",
  cyan: "text-cyan bg-cyan/10 ring-cyan/25",
  verified: "text-verified bg-verified/10 ring-verified/25",
  denied: "text-denied bg-denied/10 ring-denied/25",
  amber: "text-amber bg-amber/10 ring-amber/25",
  muted: "text-muted bg-black/[0.04] ring-black/10",
};
export function Badge({ tone = "muted", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        toneCls[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("glass rounded p-6", className)}>{children}</div>;
}

export function Dot({ tone }: { tone: Tone }) {
  const c: Record<Tone, string> = {
    violet: "bg-violet",
    cyan: "bg-cyan",
    verified: "bg-verified",
    denied: "bg-denied",
    amber: "bg-amber",
    muted: "bg-faint",
  };
  return <span className={cx("inline-block h-1.5 w-1.5 rounded-full", c[tone])} />;
}

export function Mono({ value, className, label }: { value: string; className?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1100);
  };
  return (
    <button
      onClick={copy}
      title={value}
      className={cx(
        "group inline-flex items-center gap-2 font-mono text-xs text-muted hover:text-fg transition-colors",
        className,
      )}
    >
      {label && <span className="text-faint">{label}</span>}
      <span className="truncate">{shorten(value, 10, 8)}</span>
      <span className="opacity-0 group-hover:opacity-60 transition-opacity">{copied ? "✓" : "⧉"}</span>
    </button>
  );
}
