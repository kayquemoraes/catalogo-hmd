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

    let comPreco = 0;
    let comMargem = 0;
    let prejuizo = 0;
    let somaLucro = 0;
    let somaCusto = 0;
    let somaMargens = 0;

    for (const linha of linhas) {
      for (const anuncio of linha.anuncios) {
        if (anuncio.preco <= 0) continue;
        comPreco++;
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

        comMargem++;
        somaLucro += r.lucro;
        somaCusto += linha.custo;
        if (r.margem !== null) somaMargens += r.margem;
        if (r.lucro < 0) prejuizo++;
      }
    }

    return NextResponse.json({
      produtos: total,
      comPreco,
      comMargem,
      prejuizo,
      lucroTotal: somaLucro,
      custoTotal: somaCusto,
      // Ponderada pelo custo — a que responde quanto o capital rende.
      margemPonderada: somaCusto > 0 ? somaLucro / somaCusto : null,
      // Guardada junto para quem quiser comparar: a margem do anúncio típico.
      margemSimples: comMargem > 0 ? somaMargens / comMargem : null,
    });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    return NextResponse.json({ erro: mensagem }, { status: 400 });
  }
}
