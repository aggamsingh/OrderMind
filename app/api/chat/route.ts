import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { runAgentTurn, confirmOverCap } from "@/lib/orchestrator";
import type { Session } from "@/lib/types";

export async function POST(req: NextRequest) {
  let body: { sessionId?: string; message?: string; action?: "confirm_over_cap" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionId: incomingSessionId, message, action } = body;
  const supabase = getSupabaseAdmin();

  let session: Session;
  if (incomingSessionId) {
    const { data, error } = await supabase
      .from("sessions")
      .select("*")
      .eq("id", incomingSessionId)
      .single();
    if (error || !data) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    session = data as Session;
  } else {
    const { data, error } = await supabase.from("sessions").insert({}).select("*").single();
    if (error || !data) {
      return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
    }
    session = data as Session;
    await logAudit({ sessionId: session.id, actor: "orchestrator", action: "session_created" });
  }

  if (action === "confirm_over_cap") {
    const result = await confirmOverCap(supabase, session);
    return NextResponse.json({ sessionId: session.id, ...result });
  }

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  await logAudit({
    sessionId: session.id,
    actor: "customer",
    action: "message_sent",
    detail: { message },
  });

  const result = await runAgentTurn(supabase, session, message);
  return NextResponse.json({ sessionId: session.id, ...result });
}
