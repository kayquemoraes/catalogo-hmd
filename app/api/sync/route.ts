import { NextResponse } from "next/server";
import { temSessao } from "@/lib/auth";
import { iniciarLeitura } from "@/lib/sync";
import { contaConectada } from "@/lib/bling";

export async function POST() {
  if (!(await temSessao())) {
    return NextResponse.json({ erro: "Sem sessão." }, { status: 401 });
  }

  if (!(await contaConectada())) {
    return NextResponse.json(
      { erro: "Conecte a conta do Bling antes de ler o catálogo." },
      { status: 400 }
    );
  }

  const resultado = await iniciarLeitura();
  if (!resultado.iniciada) {
    return NextResponse.json({ erro: resultado.motivo }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
