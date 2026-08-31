"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import CartCard from "./CartCard";
import ConfirmationGate from "./ConfirmationGate";
import type { CartItem } from "@/lib/types";

type ChatMessage = { role: "user" | "assistant"; text: string };

type ChatApiResponse = {
  sessionId: string;
  reply: string;
  cart: CartItem[];
  sessionStatus: string;
  pendingConfirmation: { totalPaise: number } | null;
  paymentLink: string | null;
  order: { id: string; status: string; retryCount: number } | null;
  error?: string;
};

const SUGGESTIONS = [
  "Something warm and not too sweet",
  "Two masala chai and a samosa, and yes go ahead and pay",
  "5 cold coffees and 5 brownies, pay now",
];

export default function ChatWindow() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [pendingConfirmation, setPendingConfirmation] = useState<{ totalPaise: number } | null>(null);
  const [paymentLink, setPaymentLink] = useState<string | null>(null);
  const [order, setOrder] = useState<ChatApiResponse["order"]>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function callChatApi(body: Record<string, unknown>) {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, ...body }),
    });
    const data: ChatApiResponse = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    setSessionId(data.sessionId);
    setCart(data.cart ?? []);
    setPendingConfirmation(data.pendingConfirmation ?? null);
    setPaymentLink(data.paymentLink ?? null);
    setOrder(data.order ?? null);
    return data;
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: trimmed }]);
    setLoading(true);
    try {
      const data = await callChatApi({ message: trimmed });
      setMessages((m) => [...m, { role: "assistant", text: data.reply }]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: `Something went wrong: ${err instanceof Error ? err.message : "unknown error"}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmOverCap() {
    try {
      const data = await callChatApi({ action: "confirm_over_cap" });
      setMessages((m) => [...m, { role: "assistant", text: data.reply }]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: `Something went wrong: ${err instanceof Error ? err.message : "unknown error"}` },
      ]);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        ref={scrollRef}
        className="flex max-h-96 min-h-64 flex-col gap-3 overflow-y-auto rounded-xl border border-edge bg-surface p-4 shadow-sm"
      >
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-lg">
              ☕
            </span>
            <p className="text-sm text-ink-muted">Tell me what you feel like — I&apos;ll explain every choice.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-edge bg-surface-2 px-3 py-1.5 text-xs text-ink-muted transition hover:border-accent-edge hover:text-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`flex animate-rise ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "rounded-br-md bg-accent text-white"
                    : "rounded-bl-md border border-edge bg-surface-2 text-ink"
                }`}
              >
                {m.text}
              </div>
            </div>
          ))
        )}

        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-edge bg-surface-2 px-3.5 py-3">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-ink-faint"
                  style={{ animationDelay: `${i * 160}ms` }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <CartCard cart={cart} />

      {pendingConfirmation && (
        <ConfirmationGate totalPaise={pendingConfirmation.totalPaise} onConfirm={handleConfirmOverCap} />
      )}

      {paymentLink && (
        <div className="animate-rise rounded-xl border border-allow-edge bg-allow-soft p-4">
          <p className="text-sm font-semibold text-allow">Payment ready</p>
          <a
            href={paymentLink}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block break-all text-xs font-medium text-allow underline"
          >
            {paymentLink}
          </a>
          {order && (
            <p className="mt-2 text-[11px] text-ink-muted">
              order status: <span className="font-mono">{order.status}</span>
              {order.retryCount > 0 && ` · retry ${order.retryCount}`}
            </p>
          )}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="What would you like?"
          disabled={loading}
          className="flex-1 rounded-xl border border-edge bg-surface px-4 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-accent-edge disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
        >
          Send
        </button>
      </form>

      {sessionId && (
        <Link
          href={`/audit?sessionId=${sessionId}`}
          className="text-center text-xs font-medium text-ink-muted underline transition hover:text-accent"
        >
          See every decision the agent made in this session →
        </Link>
      )}
    </div>
  );
}
