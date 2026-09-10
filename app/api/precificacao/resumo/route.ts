import { NextResponse } from "next/server";
import { temSessao } from "@/lib/auth";
import { calcular } from "@/lib/precificacao";
import { carregarTabelaFrete, listarCanais, listarLinhas } from "@/lib/precificacaoDb";
import { filtrosDaUrl } from "@/lib/filtros";

export const dynamic = "force-dynamic";

/**
 * Os números do cabeçalho, sobre TODOS os anúncios que casam com o filtro —
 * não só a página em exibição. Sem isso os cartões mudavam ao virar de página,
 * o que os torna inúteis para decidir qualquer coisa.
 *
 * O cálculo roda aqui com o mesmo `calcular` da tela. Repetir a fórmula em SQL
 * seria mais rápido e criaria uma segunda fonte de verdade — exatamente o que
 * fez a planilha divergir de si mesma.
 *
 * A margem média é ponderada pelo custo: soma-se todo o lucro e divide-se pela
 * soma de todos os custos. Responde "quanto o dinheiro investido rende", em vez
 * de dar o mesmo peso a um cabo e a um amplificador.
 *
 * Os números vêm quebrados por modalidade além do total, porque Clássico e
 * Premium têm comissões diferentes e misturá-los esconde justamente a
 * comparação que interessa: qual das duas está pagando melhor.
 */
export async function GET(req: Request) {
  if (!(await temSessao())) {
    return NextResponse.json({ erro: "Sem sessão." }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const canalId = Number(searchParams.get("canal"));
    if (!canalId) throw new Error("Informe o canal.");

    const canais = await listarCanais();
    const canal = canais.find((c) => c.id === canalId);
    if (!canal) throw new Error("Conta não encontrada.");

    const [tabela, { linhas, total }] = await Promise.all([
      carregarTabelaFrete(),
      listarLinhas(canalId, { ...filtrosDaUrl(searchParams), todas: true }),
    ]);

    /** Um acumulador por modalidade, mais o geral que soma todas. */
    type Acumulador = {
      comPreco: number;
      comMargem: number;
      prejuizo: number;
      lucro: number;
      custo: number;
      somaMargens: number;
    };
    const zerado = (): Acumulador => ({
      comPreco: 0,
      comMargem: 0,
      prejuizo: 0,
      lucro: 0,
      custo: 0,
      somaMargens: 0,
    });

    const geral = zerado();
    const porModalidade = new Map<string, Acumulador>();

    for (const linha of linhas) {
      for (const anuncio of linha.anuncios) {
        if (anuncio.preco <= 0) continue;

        let bloco = porModalidade.get(anuncio.modalidade);
        if (!bloco) {
          bloco = zerado();
          porModalidade.set(anuncio.modalidade, bloco);
        }

        for (const alvo of [bloco, geral]) alvo.comPreco++;
        if (linha.custo <= 0) continue;

        const r = calcular(
          { custo: linha.custo, peso: linha.peso },
          canal,
          {
            comissao: anuncio.comissao,
            taxaFixa: anuncio.taxaFixa,
            preco: anuncio.preco,
            promocao: anuncio.promocao,
          },
          tabela
        );

        for (const alvo of [bloco, geral]) {
          alvo.comMargem++;
          alvo.lucro += r.lucro;
          alvo.custo += linha.custo;
          if (r.margem !== null) alvo.somaMargens += r.margem;
          if (r.lucro < 0) alvo.prejuizo++;
        }
      }
    }

    const formatar = (a: Acumulador) => ({
      comPreco: a.comPreco,
      comMargem: a.comMargem,
      prejuizo: a.prejuizo,
      lucroTotal: a.lucro,
      custoTotal: a.custo,
      // Ponderada pelo custo — a que responde quanto o capital rende.
      margemPonderada: a.custo > 0 ? a.lucro / a.custo : null,
      // Guardada junto para comparação: a margem do anúncio típico.
      margemSimples: a.comMargem > 0 ? a.somaMargens / a.comMargem : null,
    });

    return NextResponse.json({
      produtos: total,
      geral: formatar(geral),
      modalidades: Object.fromEntries(
        [...porModalidade].map(([modalidade, a]) => [modalidade, formatar(a)])
      ),
    });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    return NextResponse.json({ erro: mensagem }, { status: 400 });
  }
}
