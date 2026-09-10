import { sql, ensureSchema } from "./db";
import { listarProdutos, pesoLiquido, type ProdutoLista } from "./bling";

/**
 * A leitura roda como uma tarefa contínua dentro do processo do servidor.
 * Isso funciona porque o contêiner do Railway fica de pé — não há o teto de
 * poucos minutos que existe em plataformas serverless.
 *
 * O progresso vai para o banco a cada página, então a interface acompanha
 * pelo status e um reinício não deixa a leitura fantasma no ar.
 */

let emAndamento = false;

export type Situacao = {
  rodando: boolean;
  processados: number;
  pagina: number;
  iniciadaEm: string | null;
  encerradaEm: string | null;
  resultado: string | null;
  erro: string | null;
};

export function jaRodando(): boolean {
  return emAndamento;
}

/** Dispara a leitura e devolve na hora. O acompanhamento é por /api/status. */
export async function iniciarLeitura(): Promise<{ iniciada: boolean; motivo?: string }> {
  await ensureSchema();

  if (emAndamento) {
    return { iniciada: false, motivo: "Já existe uma leitura em andamento." };
  }

  emAndamento = true;

  const [leitura] = await sql<{ id: number }[]>`
    INSERT INTO leituras (situacao) VALUES ('rodando') RETURNING id
  `;

  // Sem await: a resposta HTTP volta imediatamente.
  void executar(leitura.id).finally(() => {
    emAndamento = false;
  });

  return { iniciada: true };
}

async function executar(leituraId: number) {
  const inicio = Date.now();
  let processados = 0;
  let pagina = 1;

  try {
    // Marca o momento do corte: o que não for revisto depois disso
    // saiu do catálogo e será removido ao final.
    const corte = new Date();

    for (;;) {
      const produtos = await listarProdutos(pagina, 100);
      if (produtos.length === 0) break;

      for (const produto of produtos) {
        await gravar(produto);
        processados++;
      }

      await sql`
        UPDATE leituras
           SET processados = ${processados}, pagina = ${pagina}
         WHERE id = ${leituraId}
      `;

      pagina++;
    }

    const removidos = await sql`
      DELETE FROM produtos WHERE visto_em < ${corte}
    `;

    await sql`
      UPDATE leituras
         SET situacao = 'concluida',
             encerrada_em = now(),
             processados = ${processados},
             pagina = ${pagina},
             erro = ${null}
       WHERE id = ${leituraId}
    `;

    console.log(
      `Leitura ${leituraId} concluída: ${processados} produtos, ` +
        `${removidos.count} removidos, ${Math.round((Date.now() - inicio) / 1000)}s.`
    );
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    console.error(`Leitura ${leituraId} falhou:`, mensagem);

    await sql`
      UPDATE leituras
         SET situacao = 'falhou',
             encerrada_em = now(),
             processados = ${processados},
             pagina = ${pagina},
             erro = ${mensagem}
       WHERE id = ${leituraId}
    `;
  }
}

async function gravar(produto: ProdutoLista) {
  const peso = await pesoLiquido(produto.id);

  await sql`
    INSERT INTO produtos (id, codigo, nome, preco_custo, peso_liquido, saldo, visto_em)
    VALUES (
      ${produto.id},
      ${produto.codigo ?? null},
      ${produto.nome ?? ""},
      ${Number(produto.precoCusto ?? 0)},
      ${peso},
      ${Number(produto.estoque?.saldoVirtualTotal ?? 0)},
      now()
    )
    ON CONFLICT (id) DO UPDATE SET
      codigo       = EXCLUDED.codigo,
      nome         = EXCLUDED.nome,
      preco_custo  = EXCLUDED.preco_custo,
      peso_liquido = EXCLUDED.peso_liquido,
      saldo        = EXCLUDED.saldo,
      visto_em     = now()
  `;
}

export async function situacaoAtual(): Promise<Situacao> {
  await ensureSchema();

  const [leitura] = await sql<
    {
      situacao: string;
      iniciada_em: Date;
      encerrada_em: Date | null;
      processados: number;
      pagina: number;
      erro: string | null;
    }[]
  >`SELECT situacao, iniciada_em, encerrada_em, processados, pagina, erro
      FROM leituras ORDER BY id DESC LIMIT 1`;

  if (!leitura) {
    return {
      rodando: false,
      processados: 0,
      pagina: 0,
      iniciadaEm: null,
      encerradaEm: null,
      resultado: null,
      erro: null,
    };
  }

  return {
    rodando: leitura.situacao === "rodando",
    processados: leitura.processados,
    pagina: leitura.pagina,
    iniciadaEm: leitura.iniciada_em.toISOString(),
    encerradaEm: leitura.encerrada_em?.toISOString() ?? null,
    resultado: leitura.situacao,
    erro: leitura.erro,
  };
}
