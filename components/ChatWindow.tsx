"use client";

import { useState } from "react";
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

export default function ChatWindow() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [pendingConfirmation, setPendingConfirmation] = useState<{ totalPaise: number } | null>(
    null
  );
  const [paymentLink, setPaymentLink] = useState<string | null>(null);
  const [order, setOrder] = useState<ChatApiResponse["order"]>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function callChatApi(body: Record<string, unknown>) {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, ...body }),
    });
    const data: ChatApiResponse = await res.json();
    if (!res.ok) {
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    setSessionId(data.sessionId);
    setCart(data.cart ?? []);
    setPendingConfirmation(data.pendingConfirmation ?? null);
    setPaymentLink(data.paymentLink ?? null);
    setOrder(data.order ?? null);
    return data;
  }

  async function sendMessage() {
    const trimmed = input.trim();
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
        { role: "assistant", text: `(error: ${err instanceof Error ? err.message : "unknown"})` },
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
        { role: "assistant", text: `(error: ${err instanceof Error ? err.message : "unknown"})` },
      ]);
    }
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">OrderMind — Chai Point Express</h1>
        {sessionId && (
          <Link href={`/audit?sessionId=${sessionId}`} className="text-sm text-blue-600 hover:underline">
            View audit trail →
          </Link>
        )}
      </header>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
        {messages.length === 0 && (
          <p className="text-sm text-zinc-500">
            Try: &ldquo;I want something warm and not too sweet&rdquo;
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
              m.role === "user"
                ? "self-end bg-blue-600 text-white"
                : "self-start bg-white text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
            }`}
          >
            {m.text}
          </div>
        ))}
      </div>

      <CartCard cart={cart} />

      {pendingConfirmation && (
        <ConfirmationGate totalPaise={pendingConfirmation.totalPaise} onConfirm={handleConfirmOverCap} />
      )}

      {paymentLink && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-800 dark:bg-emerald-950">
          Payment link ready:{" "}
          <a href={paymentLink} target="_blank" rel="noopener noreferrer" className="underline">
            {paymentLink}
          </a>
          {order && <span className="ml-2 text-zinc-500">(order status: {order.status})</span>}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage();
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your order…"
          disabled={loading}
          className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
