import AppShell from "@/components/AppShell";
import PrincipalConsole from "@/components/PrincipalConsole";

export const metadata = {
  title: "Principal console — OrderMind",
  description: "Grant, watch, and revoke the spending authority your AI agent acts under.",
};

export default function PrincipalPage() {
  return (
    <AppShell
      active="/principal"
      title="Your agent's spending authority"
      subtitle="You delegated money to a program. This is where you see what it is allowed to spend, what it actually spent — and take that permission back."
    >
      <PrincipalConsole />
    </AppShell>
  );
}
