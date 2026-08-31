import AppShell from "@/components/AppShell";
import ChatWindow from "@/components/ChatWindow";
import MetricsBar from "@/components/MetricsBar";

export default function ChatPage() {
  return (
    <AppShell
      active="/"
      title="Order by chatting"
      subtitle="The agent explains every item it adds, suggests exactly one add-on, and cannot spend over ₹500 without your explicit approval."
    >
      <MetricsBar />
      <ChatWindow />
    </AppShell>
  );
}
