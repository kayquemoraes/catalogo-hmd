import { NextResponse } from "next/server";
import { temSessao } from "@/lib/auth";
import {
  carregarTabelaFrete,
  listarCanais,
  lerParametros,
  totalDoCatalogo,
} from "@/lib/precificacaoDb";

export const dynamic = "force-dynamic";

/**
 * O que a tela precisa saber uma única vez: parâmetros, canais e a tabela de
 * frete. Com isso em mãos o navegador calcula sozinho, e o número acompanha a
 * digitação como numa planilha. As linhas vêm à parte, paginadas, em /linhas.
 */
export async function GET() {
  if (!(await temSessao())) {
    return NextResponse.json({ erro: "Sem sessão." }, { status: 401 });
  }

  try {
    const [canais, parametros, tabelaFrete, produtosNoCatalogo] = await Promise.all([
      listarCanais(),
      lerParametros(),
      carregarTabelaFrete(),
      totalDoCatalogo(),
    ]);

    return NextResponse.json({
      parametros,
      canais,
      canalAtual: canais[0]?.id ?? null,
      tabelaFrete,
      produtosNoCatalogo,
    });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    return NextResponse.json({ erro: mensagem }, { status: 500 });
  }
}
