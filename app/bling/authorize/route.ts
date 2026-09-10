import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { temSessao } from "@/lib/auth";
import { urlDeAutorizacao } from "@/lib/bling";
import { enderecoDaAplicacao } from "@/lib/appUrl";

export async function GET() {
  if (!(await temSessao())) {
    return NextResponse.redirect(`${enderecoDaAplicacao()}/entrar`);
  }

  const state = randomUUID();

  const jar = await cookies();
  jar.set("bling_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(urlDeAutorizacao(state));
}
