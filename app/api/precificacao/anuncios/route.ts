import { NextResponse } from "next/server";
import { temSessao } from "@/lib/auth";
import { adicionarAoCanal, removerDoCanal, salvarAnuncio } from "@/lib/precificacaoDb";

export const dynamic = "force-dynamic";

async function protegido(): Promise<NextResponse | null> {
  if (!(await temSessao())) {
    return NextResponse.json({ erro: "Sem sessão." }, { status: 401 });
  }
  return null;
}

function falha(erro: unknown) {
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  return NextResponse.json({ erro: mensagem }, { status: 400 });
}

/** Passa a anunciar um produto no canal. No Mercado Livre cria Clássico e Premium. */
export async function POST(req: Request) {
  const barrado = await protegido();
  if (barrado) return barrado;

  try {
    const { canalId, sku } = (await req.json()) as { canalId?: number; sku?: string };
    if (!canalId || !sku) throw new Error("Informe o canal e o SKU.");
    await adicionarAoCanal(canalId, sku);
    return NextResponse.json({ ok: true });
  } catch (erro) {
    return falha(erro);
  }
}

/** Salva preço, comissão ou taxa de um anúncio. */
export async function PATCH(req: Request) {
  const barrado = await protegido();
  if (barrado) return barrado;

  try {
    const corpo = (await req.json()) as {
      anuncioId?: number;
      comissao?: number;
      taxaFixa?: number;
      preco?: number;
    };
    if (!corpo.anuncioId) throw new Error("Informe o anúncio.");

    for (const [campo, valor] of Object.entries(corpo)) {
      if (campo === "anuncioId") continue;
      if (valor !== undefined && (!Number.isFinite(valor) || valor < 0)) {
        throw new Error(`Valor inválido em ${campo}.`);
      }
    }

    await salvarAnuncio(corpo.anuncioId, {
      comissao: corpo.comissao,
      taxaFixa: corpo.taxaFixa,
      preco: corpo.preco,
    });
    return NextResponse.json({ ok: true });
  } catch (erro) {
    return falha(erro);
  }
}

/** Deixa de anunciar o produto no canal, removendo todas as suas modalidades. */
export async function DELETE(req: Request) {
  const barrado = await protegido();
  if (barrado) return barrado;

  try {
    const { canalId, sku } = (await req.json()) as { canalId?: number; sku?: string };
    if (!canalId || !sku) throw new Error("Informe o canal e o SKU.");
    await removerDoCanal(canalId, sku);
    return NextResponse.json({ ok: true });
  } catch (erro) {
    return falha(erro);
  }
}
