import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  checkConsolePassword,
  issuePrincipalSession,
  readPrincipalSession,
  PRINCIPAL_COOKIE,
} from "@/lib/principal-auth";

/** Who am I signed in as? Used by the console to decide what to render. */
export async function GET() {
  const jar = await cookies();
  const principal = readPrincipalSession(jar.get(PRINCIPAL_COOKIE)?.value);
  return NextResponse.json({ principal });
}

/** Sign in to the principal console. */
export async function POST(req: NextRequest) {
  let body: { principal?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const principal = body.principal?.trim();
  if (!principal) {
    return NextResponse.json({ error: "invalid_request", message: "principal is required." }, { status: 400 });
  }
  if (!checkConsolePassword(body.password ?? "")) {
    // Deliberately does not distinguish "wrong password" from "no password
    // configured" — an unauthenticated caller learns nothing about which.
    return NextResponse.json(
      { error: "invalid_credentials", message: "That console password is not correct." },
      { status: 401 }
    );
  }

  const session = issuePrincipalSession(principal);
  const res = NextResponse.json({ principal });
  res.cookies.set(session.cookieName, session.value, {
    httpOnly: true, // the console never needs to read this from JS
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: session.maxAge,
  });
  return res;
}

/** Sign out. */
export async function DELETE() {
  const res = NextResponse.json({ principal: null });
  res.cookies.set(PRINCIPAL_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
