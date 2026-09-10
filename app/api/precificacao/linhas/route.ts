import { NextResponse } from "next/server";
import { temSessao } from "@/lib/auth";
import { listarLinhas } from "@/lib/precificacaoDb";
import { filtrosDaUrl } from "@/lib/filtros";

export const dynamic = "force-dynamic";

/** A lista da tela, já filtrada e paginada no banco. */
export async function GET(req: Request) {
  if (!(await temSessao())) {
    return NextResponse.json({ erro: "Sem sessão." }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const canalId = Number(searchParams.get("canal"));
    if (!canalId) throw new Error("Informe o canal.");

    const dados = await listarLinhas(canalId, {
      ...filtrosDaUrl(searchParams),
      pagina: Number(searchParams.get("pagina") ?? 1),
    });

    return NextResponse.json(dados);
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    return NextResponse.json({ erro: mensagem }, { status: 400 });
  }
}
