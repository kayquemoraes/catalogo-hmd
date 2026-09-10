import { NextResponse } from "next/server";
import { temSessao } from "@/lib/auth";
import {
  comFaixaAdicionada,
  comFaixaAlterada,
  comFaixaFinalAdicionada,
  semFaixa,
} from "@/lib/precificacao";
import {
  carregarTabelaFrete,
  salvarTabelaFrete,
  salvarValorFrete,
} from "@/lib/precificacaoDb";

export const dynamic = "force-dynamic";

async function protegido() {
  return (await temSessao())
    ? null
    : NextResponse.json({ erro: "Sem sessão." }, { status: 401 });
}

function falha(erro: unknown, status = 400) {
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  return NextResponse.json({ erro: mensagem }, { status });
}

function eixoDe(valor: unknown): "peso" | "preco" {
  if (valor !== "peso" && valor !== "preco") throw new Error("Eixo inválido.");
  return valor;
}

/** A matriz inteira: faixas de peso, faixas de preço e os valores. */
export async function GET() {
  const barrado = await protegido();
  if (barrado) return barrado;

  try {
    return NextResponse.json({ tabela: await carregarTabelaFrete() });
  } catch (erro) {
    return falha(erro, 500);
  }
}

/**
 * Altera uma célula ou uma faixa.
 *
 * A célula é gravada direto, que é o caso comum. A faixa passa pelas funções
 * puras do motor: mexer num teto pode reordenar o eixo e arrastar linhas ou
 * colunas junto, e essa regra tem de ser a mesma que o cálculo usa.
 */
export async function PATCH(req: Request) {
  const barrado = await protegido();
  if (barrado) return barrado;

  try {
    const corpo = await req.json();

    if (corpo.tipo === "valor") {
      const peso = Number(corpo.pesoOrdem);
      const preco = Number(corpo.precoOrdem);
      if (!Number.isInteger(peso) || !Number.isInteger(preco)) {
        throw new Error("Posição inválida na tabela.");
      }
      await salvarValorFrete(peso, preco, Number(corpo.valor));
      return NextResponse.json({ ok: true });
    }

    if (corpo.tipo === "faixa") {
      const eixo = eixoDe(corpo.eixo);
      const indice = Number(corpo.indice);
      if (!Number.isInteger(indice)) throw new Error("Faixa inválida.");

      const atual = await carregarTabelaFrete();
      const nova = comFaixaAlterada(atual, eixo, indice, {
        rotulo: corpo.rotulo,
        ate: corpo.ate === undefined ? undefined : Number(corpo.ate),
      });
      await salvarTabelaFrete(nova);
      return NextResponse.json({ ok: true, tabela: nova });
    }

    throw new Error("Tipo de alteração desconhecido.");
  } catch (erro) {
    return falha(erro);
  }
}

/**
 * Acrescenta uma faixa.
 *
 * Com `final`, a faixa nasce no topo e sem teto, e a que era aberta ganha o
 * limite informado — estender o topo da tabela são duas mudanças que precisam
 * acontecer juntas. Sem `final`, a faixa tem teto próprio e entra na posição
 * que esse teto determina.
 */
export async function POST(req: Request) {
  const barrado = await protegido();
  if (barrado) return barrado;

  try {
    const corpo = await req.json();
    const eixo = eixoDe(corpo.eixo);
    const rotulo = String(corpo.rotulo ?? "");

    const atual = await carregarTabelaFrete();
    const nova = corpo.final
      ? comFaixaFinalAdicionada(atual, eixo, {
          rotulo,
          tetoAnterior: Number(corpo.ate),
        })
      : comFaixaAdicionada(atual, eixo, { rotulo, ate: Number(corpo.ate) });

    await salvarTabelaFrete(nova);
    return NextResponse.json({ ok: true, tabela: nova });
  } catch (erro) {
    return falha(erro);
  }
}

/** Remove uma faixa; o intervalo dela volta para a faixa seguinte. */
export async function DELETE(req: Request) {
  const barrado = await protegido();
  if (barrado) return barrado;

  try {
    const corpo = await req.json();
    const eixo = eixoDe(corpo.eixo);
    const indice = Number(corpo.indice);
    if (!Number.isInteger(indice)) throw new Error("Faixa inválida.");

    const atual = await carregarTabelaFrete();
    const nova = semFaixa(atual, eixo, indice);
    await salvarTabelaFrete(nova);
    return NextResponse.json({ ok: true, tabela: nova });
  } catch (erro) {
    return falha(erro);
  }
}
