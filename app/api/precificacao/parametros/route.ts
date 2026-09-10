import { NextResponse } from "next/server";
import { temSessao } from "@/lib/auth";
import { salvarParametros } from "@/lib/precificacaoDb";

export const dynamic = "force-dynamic";

/** Imposto padrão, antecipação e embalagem — o que a aba `custo` guardava. */
export async function PUT(req: Request) {
  if (!(await temSessao())) {
    return NextResponse.json({ erro: "Sem sessão." }, { status: 401 });
  }

  try {
    const corpo = (await req.json()) as {
      imposto?: number;
      antecipacao?: number;
      embalagem?: number;
    };

    const imposto = Number(corpo.imposto ?? 0);
    const antecipacao = Number(corpo.antecipacao ?? 0);
    const embalagem = Number(corpo.embalagem ?? 0);

    if (![imposto, antecipacao].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) {
      throw new Error("Imposto e antecipação devem ficar entre 0% e 100%.");
    }
    if (!Number.isFinite(embalagem) || embalagem < 0) {
      throw new Error("A embalagem não pode ser negativa.");
    }

    await salvarParametros({ imposto, antecipacao, embalagem });
    return NextResponse.json({ ok: true });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    return NextResponse.json({ erro: mensagem }, { status: 400 });
  }
}
