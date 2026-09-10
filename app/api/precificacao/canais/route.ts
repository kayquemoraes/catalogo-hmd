import { NextResponse } from "next/server";
import { temSessao } from "@/lib/auth";
import {
  atualizarCanal,
  criarCanal,
  listarCanais,
  lerParametros,
  removerCanal,
} from "@/lib/precificacaoDb";
import type { TipoCanal } from "@/lib/precificacao";

export const dynamic = "force-dynamic";

function falha(erro: unknown, status = 400) {
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  return NextResponse.json({ erro: mensagem }, { status });
}

async function protegido() {
  return (await temSessao())
    ? null
    : NextResponse.json({ erro: "Sem sessão." }, { status: 401 });
}

/** Percentual guardado como fração: 10% vira 0.1. */
function fracao(valor: unknown, campo: string): number {
  const n = Number(valor ?? 0);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new Error(`${campo} deve ficar entre 0% e 100%.`);
  }
  return n;
}

function reais(valor: unknown, campo: string): number {
  const n = Number(valor ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${campo} não pode ser negativo.`);
  return n;
}

/** As contas cadastradas, mais os valores sugeridos para uma conta nova. */
export async function GET() {
  const barrado = await protegido();
  if (barrado) return barrado;

  try {
    const [canais, padroes] = await Promise.all([listarCanais(), lerParametros()]);
    return NextResponse.json({ canais, padroes });
  } catch (erro) {
    return falha(erro, 500);
  }
}

export async function POST(req: Request) {
  const barrado = await protegido();
  if (barrado) return barrado;

  try {
    const corpo = await req.json();
    const nome = String(corpo.nome ?? "").trim();
    if (!nome) throw new Error("Dê um nome à conta.");
    if (corpo.tipo !== "ml" && corpo.tipo !== "shopee") {
      throw new Error("Escolha Mercado Livre ou Shopee.");
    }

    const canal = await criarCanal({
      nome,
      tipo: corpo.tipo as TipoCanal,
      imposto: fracao(corpo.imposto, "Imposto"),
      antecipacao: fracao(corpo.antecipacao, "Antecipação"),
      embalagem: reais(corpo.embalagem, "Embalagem"),
      promocaoPadrao: fracao(corpo.promocaoPadrao, "Promoção padrão"),
    });

    return NextResponse.json({ ok: true, canal });
  } catch (erro) {
    if (erro instanceof Error && erro.message.includes("prec_canais_nome_key")) {
      return falha(new Error("Já existe uma conta com esse nome."));
    }
    return falha(erro);
  }
}

export async function PATCH(req: Request) {
  const barrado = await protegido();
  if (barrado) return barrado;

  try {
    const corpo = await req.json();
    const id = Number(corpo.id);
    if (!id) throw new Error("Informe a conta.");

    await atualizarCanal(id, {
      imposto: fracao(corpo.imposto, "Imposto"),
      antecipacao: fracao(corpo.antecipacao, "Antecipação"),
      embalagem: reais(corpo.embalagem, "Embalagem"),
      promocaoPadrao: fracao(corpo.promocaoPadrao, "Promoção padrão"),
    });

    return NextResponse.json({ ok: true });
  } catch (erro) {
    return falha(erro);
  }
}

/** Apaga a conta e, junto, todos os anúncios dela. */
export async function DELETE(req: Request) {
  const barrado = await protegido();
  if (barrado) return barrado;

  try {
    const corpo = await req.json();
    const id = Number(corpo.id);
    if (!id) throw new Error("Informe a conta.");
    await removerCanal(id);
    return NextResponse.json({ ok: true });
  } catch (erro) {
    return falha(erro);
  }
}
