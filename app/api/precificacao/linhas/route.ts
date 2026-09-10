import { NextResponse } from "next/server";
import { temSessao } from "@/lib/auth";
import { listarLinhas, type Situacao } from "@/lib/precificacaoDb";

export const dynamic = "force-dynamic";

const SITUACOES: Situacao[] = ["todos", "anunciados", "disponiveis"];

/** A lista da tela, já filtrada e paginada no banco. */
export async function GET(req: Request) {
  if (!(await temSessao())) {
    return NextResponse.json({ erro: "Sem sessão." }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const canalId = Number(searchParams.get("canal"));
    if (!canalId) throw new Error("Informe o canal.");

    const pedida = searchParams.get("situacao") as Situacao | null;
    const situacao = pedida && SITUACOES.includes(pedida) ? pedida : "todos";

    const dados = await listarLinhas(canalId, {
      busca: searchParams.get("q") ?? "",
      situacao,
      pagina: Number(searchParams.get("pagina") ?? 1),
    });

    return NextResponse.json(dados);
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    return NextResponse.json({ erro: mensagem }, { status: 400 });
  }
}
