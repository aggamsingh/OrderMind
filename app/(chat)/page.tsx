import AppShell from "@/components/AppShell";
import ChatWindow from "@/components/ChatWindow";
import MetricsBar from "@/components/MetricsBar";
import Thesis from "@/components/Thesis";

export default function ChatPage() {
  return (
    <AppShell
      active="/"
      title="A merchant an AI buyer can safely transact with"
      subtitle="Chai Point Express sells to humans and to autonomous agents through one set of rules — every money action explainable, bounded, and gated on both sides."
    >
      <Thesis />
      <MetricsBar />
      <ChatWindow />
    </AppShell>
  );
}
