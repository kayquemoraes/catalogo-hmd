import { NextResponse } from "next/server";
import { temSessao } from "@/lib/auth";
import { atualizarCanal, criarCanal } from "@/lib/precificacaoDb";
import type { TipoCanal } from "@/lib/precificacao";

export const dynamic = "force-dynamic";

function falha(erro: unknown) {
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  return NextResponse.json({ erro: mensagem }, { status: 400 });
}

function fracao(valor: unknown, campo: string): number {
  const n = Number(valor ?? 0);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new Error(`${campo} deve ser um percentual entre 0 e 100.`);
  }
  return n;
}

/** Cria uma conta de vendedor: mlHmd3, spHmd2, o que for. */
export async function POST(req: Request) {
  if (!(await temSessao())) {
    return NextResponse.json({ erro: "Sem sessão." }, { status: 401 });
  }

  try {
    const corpo = (await req.json()) as {
      nome?: string;
      tipo?: TipoCanal;
      imposto?: number;
      antecipacaoAtiva?: boolean;
      embalagemAtiva?: boolean;
      promocao?: number;
    };

    const nome = (corpo.nome ?? "").trim();
    if (!nome) throw new Error("Dê um nome ao canal.");
    if (corpo.tipo !== "ml" && corpo.tipo !== "shopee") {
      throw new Error("Escolha Mercado Livre ou Shopee.");
    }

    const canal = await criarCanal({
      nome,
      tipo: corpo.tipo,
      imposto: fracao(corpo.imposto, "Imposto"),
      antecipacaoAtiva: Boolean(corpo.antecipacaoAtiva),
      embalagemAtiva: corpo.embalagemAtiva !== false,
      promocao: fracao(corpo.promocao, "Promoção"),
    });

    return NextResponse.json({ ok: true, canal });
  } catch (erro) {
    // Nome repetido vira uma violação de unicidade no banco; traduz para algo legível.
    if (erro instanceof Error && erro.message.includes("prec_canais_nome_key")) {
      return falha(new Error("Já existe um canal com esse nome."));
    }
    return falha(erro);
  }
}

/** Ajusta imposto, promoção e as chaves de antecipação e embalagem. */
export async function PATCH(req: Request) {
  if (!(await temSessao())) {
    return NextResponse.json({ erro: "Sem sessão." }, { status: 401 });
  }

  try {
    const corpo = (await req.json()) as {
      id?: number;
      imposto?: number;
      antecipacaoAtiva?: boolean;
      embalagemAtiva?: boolean;
      promocao?: number;
    };
    if (!corpo.id) throw new Error("Informe o canal.");

    await atualizarCanal(corpo.id, {
      imposto: fracao(corpo.imposto, "Imposto"),
      antecipacaoAtiva: Boolean(corpo.antecipacaoAtiva),
      embalagemAtiva: Boolean(corpo.embalagemAtiva),
      promocao: fracao(corpo.promocao, "Promoção"),
    });

    return NextResponse.json({ ok: true });
  } catch (erro) {
    return falha(erro);
  }
}
