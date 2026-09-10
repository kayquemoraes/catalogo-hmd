import { NextResponse } from "next/server";
import { temSessao } from "@/lib/auth";
import { listarDisponiveis } from "@/lib/precificacaoDb";

export const dynamic = "force-dynamic";

/** Produtos do catálogo que ainda não são anunciados no canal escolhido. */
export async function GET(req: Request) {
  if (!(await temSessao())) {
    return NextResponse.json({ erro: "Sem sessão." }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const canalId = Number(searchParams.get("canal"));
    if (!canalId) throw new Error("Informe o canal.");

    const busca = searchParams.get("q") ?? "";
    const { produtos, total } = await listarDisponiveis(canalId, busca);

    return NextResponse.json({ produtos, total });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    return NextResponse.json({ erro: mensagem }, { status: 400 });
  }
}
