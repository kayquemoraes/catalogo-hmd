import { NextResponse } from "next/server";
import { temSessao } from "@/lib/auth";
import {
  carregarTabelaFrete,
  listarAnuncios,
  listarCanais,
  lerParametros,
} from "@/lib/precificacaoDb";

export const dynamic = "force-dynamic";

/**
 * Entrega de uma vez tudo que a tela precisa para calcular sozinha:
 * parâmetros, canais, tabela de frete e os anúncios do canal escolhido.
 *
 * O cálculo acontece no navegador para o número mudar junto com a digitação,
 * como numa planilha. O servidor só entra de novo na hora de salvar.
 */
export async function GET(req: Request) {
  if (!(await temSessao())) {
    return NextResponse.json({ erro: "Sem sessão." }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const canais = await listarCanais();

    const pedido = Number(searchParams.get("canal"));
    const canal = canais.find((c) => c.id === pedido) ?? canais[0] ?? null;

    const [parametros, tabelaFrete, anuncios] = await Promise.all([
      lerParametros(),
      carregarTabelaFrete(),
      canal ? listarAnuncios(canal.id) : Promise.resolve([]),
    ]);

    return NextResponse.json({
      parametros,
      canais,
      canalAtual: canal?.id ?? null,
      tabelaFrete,
      anuncios,
    });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    return NextResponse.json({ erro: mensagem }, { status: 500 });
  }
}
