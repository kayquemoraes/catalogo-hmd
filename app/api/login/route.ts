import { NextResponse } from "next/server";
import { conferirSenha, abrirSessao } from "@/lib/auth";

export async function POST(req: Request) {
  const { senha } = (await req.json()) as { senha?: string };

  if (!senha || !conferirSenha(senha)) {
    return NextResponse.json({ erro: "Senha incorreta." }, { status: 401 });
  }

  await abrirSessao();
  return NextResponse.json({ ok: true });
}
