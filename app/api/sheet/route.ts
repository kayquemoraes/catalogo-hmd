import { NextResponse } from "next/server";
import { temSessao } from "@/lib/auth";
import { escreverPlanilha } from "@/lib/sheets";

export async function POST() {
  if (!(await temSessao())) {
    return NextResponse.json({ erro: "Sem sessão." }, { status: 401 });
  }

  try {
    const { linhas } = await escreverPlanilha();
    return NextResponse.json({ ok: true, linhas });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    return NextResponse.json({ erro: mensagem }, { status: 400 });
  }
}
