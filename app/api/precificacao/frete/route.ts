import { NextResponse } from "next/server";
import { temSessao } from "@/lib/auth";
import { carregarTabelaFrete, salvarFaixa, salvarValorFrete } from "@/lib/precificacaoDb";

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
 * As duas coisas moram na mesma rota porque são a mesma tabela vista de dois
 * ângulos, e a tela salva uma de cada vez conforme o campo perde o foco.
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

    if (corpo.tipo === "faixaPeso" || corpo.tipo === "faixaPreco") {
      const ordem = Number(corpo.ordem);
      if (!Number.isInteger(ordem)) throw new Error("Faixa inválida.");
      await salvarFaixa(corpo.tipo === "faixaPeso" ? "peso" : "preco", ordem, {
        rotulo: corpo.rotulo,
        // `null` é o teto ausente da última faixa; `undefined` é "não mexa".
        ate: corpo.ate === undefined ? undefined : corpo.ate === null ? null : Number(corpo.ate),
      });
      return NextResponse.json({ ok: true });
    }

    throw new Error("Tipo de alteração desconhecido.");
  } catch (erro) {
    return falha(erro);
  }
}

