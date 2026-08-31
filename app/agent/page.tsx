import AppShell from "@/components/AppShell";
import AgentTheatre from "@/components/AgentTheatre";
import MandateExplainer from "@/components/MandateExplainer";

export const metadata = {
  title: "Agent-to-agent — OrderMind",
  description: "An autonomous AI buyer transacting with a merchant under a signed spend mandate.",
};

export default function AgentPage() {
  return (
    <AppShell
      active="/agent"
      wide
      title="A machine buying from a machine"
      subtitle="No human, no browser, no chat window. An autonomous buyer discovers this merchant, negotiates a basket, and pays — and the merchant refuses it when it overreaches."
    >
      <MandateExplainer />
      <AgentTheatre />
    </AppShell>
  );
}
