"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buscarFrete, indiceDaFaixa, indiceDaFaixaPeso, type TabelaFrete } from "@/lib/precificacao";
import { apenasNumero, emReais, paraNumero } from "@/lib/numero";

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export default function Fretes() {
  const [tabela, setTabela] = useState<TabelaFrete | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(0);
  const [editandoFaixas, setEditandoFaixas] = useState(false);

  // Simulação: peso e preço de um produto qualquer, para ver a regra agir.
  const [peso, setPeso] = useState("");
  const [preco, setPreco] = useState("");

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/precificacao/frete");
      const dados = await r.json();
      if (!r.ok) throw new Error(dados.erro ?? "Não foi possível carregar.");
      setTabela(dados.tabela);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // --- simulação -----------------------------------------------------------

  /**
   * Usa a mesma busca do cálculo de preços. Se a simulação usasse uma regra
   * própria, ela poderia concordar com a tabela e discordar do que o sistema
   * de fato cobra — que é o oposto do que este painel serve para mostrar.
   */
  const simulacao = useMemo(() => {
    if (!tabela) return null;
    const p = paraNumero(peso);
    const v = paraNumero(preco);
    if (p === null || v === null || p < 0 || v < 0) return null;

    return {
      linha: indiceDaFaixaPeso(tabela.faixasPeso, p),
      coluna: indiceDaFaixa(tabela.faixasPreco, v),
      ...buscarFrete(tabela, p, v),
    };
  }, [tabela, peso, preco]);

  // --- escrita -------------------------------------------------------------

  const enviar = useCallback(
    async (corpo: Record<string, unknown>, otimista: (t: TabelaFrete) => TabelaFrete) => {
      setTabela((antes) => (antes ? otimista(antes) : antes));
      setSalvando((n) => n + 1);
      try {
        const r = await fetch("/api/precificacao/frete", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corpo),
        });
        if (!r.ok) throw new Error((await r.json()).erro ?? "Não foi possível salvar.");
        setErro(null);
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e));
        await carregar();
      } finally {
        setSalvando((n) => n - 1);
      }
    },
    [carregar]
  );

  const salvarValor = (linha: number, coluna: number, valor: number) =>
    enviar({ tipo: "valor", pesoOrdem: linha, precoOrdem: coluna, valor }, (t) => ({
      ...t,
      valores: t.valores.map((l, i) =>
        i === linha ? l.map((v, j) => (j === coluna ? valor : v)) : l
      ),
    }));

  /**
   * Faixas mudam a forma da tabela — acrescentar ou reordenar arrasta linhas e
   * colunas —, então o servidor devolve a tabela inteira já resolvida em vez de
   * a tela tentar prever o resultado.
   */
  const operarFaixa = useCallback(
    async (metodo: "PATCH" | "POST" | "DELETE", corpo: Record<string, unknown>) => {
      setSalvando((n) => n + 1);
      try {
        const r = await fetch("/api/precificacao/frete", {
          method: metodo,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corpo),
        });
        const dados = await r.json();
        if (!r.ok) throw new Error(dados.erro ?? "Não foi possível salvar.");
        if (dados.tabela) setTabela(dados.tabela);
        setErro(null);
        return true;
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setSalvando((n) => n - 1);
      }
    },
    []
  );

  const salvarFaixa = (
    eixo: "peso" | "preco",
    indice: number,
    campos: { rotulo?: string; ate?: number }
  ) => operarFaixa("PATCH", { tipo: "faixa", eixo, indice, ...campos });

  const adicionarFaixa = (
    eixo: "peso" | "preco",
    rotulo: string,
    ate: number,
    final: boolean
  ) => operarFaixa("POST", { eixo, rotulo, ate, final });

  const removerFaixa = (eixo: "peso" | "preco", indice: number) =>
    operarFaixa("DELETE", { eixo, indice });

  // --- tela ----------------------------------------------------------------

  return (
    <main className="min-h-screen">
      <header className="bg-ink text-paper">
        <div className="mx-auto max-w-[1800px] px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Fretes</h1>
              <p className="text-sage-deep mt-1.5 max-w-2xl text-sm">
                O frete de cada anúncio sai do cruzamento entre o{" "}
                <strong className="text-paper">peso do produto</strong> e o{" "}
                <strong className="text-paper">preço do anúncio</strong>. Vale para o Mercado
                Livre; a Shopee não usa esta tabela.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {salvando > 0 && <span className="text-sage-deep text-sm">Salvando…</span>}
              <button
                onClick={() => setEditandoFaixas((v) => !v)}
                className="border-ink-line rounded-[6px] border px-3.5 py-2 text-sm font-medium hover:bg-ink-soft"
              >
                {editandoFaixas ? "Fechar faixas" : "Editar faixas"}
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1800px] px-4 py-4 sm:px-6">
        {erro && (
          <Faixa onFechar={() => setErro(null)}>
            {erro}
          </Faixa>
        )}
        {carregando || !tabela ? (
          <p className="text-muted text-sm">Carregando…</p>
        ) : (
          <>
            <Simulador
              peso={peso}
              preco={preco}
              onPeso={setPeso}
              onPreco={setPreco}
              resultado={simulacao}
            />

            {editandoFaixas && (
              <EditorDeFaixas
                tabela={tabela}
                onSalvar={salvarFaixa}
                onAdicionar={adicionarFaixa}
                onRemover={removerFaixa}
              />
            )}

            <Matriz
              tabela={tabela}
              destaque={simulacao ? { linha: simulacao.linha, coluna: simulacao.coluna } : null}
              onSalvar={salvarValor}
            />

            <p className="text-muted mt-4 text-xs">
              {tabela.faixasPeso.length} faixas de peso × {tabela.faixasPreco.length} de preço ={" "}
              {tabela.faixasPeso.length * tabela.faixasPreco.length} valores. Cada um é salvo ao
              sair do campo.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------

function Faixa({
  children,
  onFechar,
}: {
  children: React.ReactNode;
  onFechar: () => void;
}) {
  return (
    <div className="bg-alert-soft text-alert mb-4 flex items-start justify-between gap-4 rounded-[6px] px-4 py-3 text-sm">
      <span>{children}</span>
      <button onClick={onFechar} className="shrink-0 underline underline-offset-4">
        fechar
      </button>
    </div>
  );
}

/**
 * Mostra a regra agindo: informe peso e preço e veja qual célula é escolhida,
 * destacada na matriz. Uma tabela de 232 números não explica sozinha por que um
 * produto pagou o que pagou; isto explica.
 */
function Simulador({
  peso,
  preco,
  onPeso,
  onPreco,
  resultado,
}: {
  peso: string;
  preco: string;
  onPeso: (v: string) => void;
  onPreco: (v: string) => void;
  resultado: { valor: number; faixaPeso: string; faixaPreco: string } | null;
}) {
  return (
    <section className="border-sage bg-paper-raised mb-4 flex flex-wrap items-end justify-between gap-4 rounded-[6px] border p-4">
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="mr-2 pb-1.5 text-sm font-semibold">Qual frete este produto paga?</h2>
        <label className="text-sm">
          <span className="text-muted block text-xs">Peso do produto</span>
          <div className="mt-1 flex items-center gap-1.5">
            <input
              value={peso}
              inputMode="decimal"
              onInput={(e) => apenasNumero(e.currentTarget)}
              onChange={(e) => onPeso(e.target.value)}
              placeholder="0,3"
              className="num border-sage focus:border-signal w-24 rounded-[6px] border px-2 py-1.5 text-right"
            />
            <span className="text-muted text-sm">kg</span>
          </div>
        </label>

        <label className="text-sm">
          <span className="text-muted block text-xs">Preço do anúncio</span>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="text-muted text-sm">R$</span>
            <input
              value={preco}
              inputMode="decimal"
              onInput={(e) => apenasNumero(e.currentTarget)}
              onChange={(e) => onPreco(e.target.value)}
              placeholder="59,90"
              className="num border-sage focus:border-signal w-28 rounded-[6px] border px-2 py-1.5 text-right"
            />
          </div>
        </label>
      </div>

      {resultado ? (
        <p className="bg-signal-soft text-signal rounded-[6px] px-4 py-2 text-sm">
          <span className="num text-lg font-semibold">{moeda.format(resultado.valor)}</span>
          <span className="ml-2">
            {resultado.faixaPeso} × {resultado.faixaPreco}
          </span>
        </p>
      ) : (
        <p className="text-muted pb-1.5 text-sm">
          Informe os dois valores para ver a célula usada, destacada na tabela.
        </p>
      )}
    </section>
  );
}

/**
 * Rótulos e limites das faixas.
 *
 * Fica fechado por padrão: mexer aqui muda em que célula cada produto cai, o
 * que é bem mais consequente do que corrigir um valor.
 */
function EditorDeFaixas({
  tabela,
  onSalvar,
  onAdicionar,
  onRemover,
}: {
  tabela: TabelaFrete;
  onSalvar: (
    eixo: "peso" | "preco",
    indice: number,
    campos: { rotulo?: string; ate?: number }
  ) => Promise<boolean>;
  onAdicionar: (
    eixo: "peso" | "preco",
    rotulo: string,
    ate: number,
    final: boolean
  ) => Promise<boolean>;
  onRemover: (eixo: "peso" | "preco", indice: number) => Promise<boolean>;
}) {
  return (
    <section className="border-sage bg-paper-raised mb-4 rounded-[6px] border p-4">
      <h2 className="text-sm font-semibold">Faixas</h2>
      <p className="text-muted mt-1 max-w-3xl text-sm">
        O <strong>limite</strong> e o teto da faixa, e as faixas ficam sempre em ordem
        crescente — acrescentar uma a coloca no lugar certo sozinha. Dois limites iguais sao
        recusados. A ultima faixa de cada eixo nao tem teto: e ela que recolhe tudo o que
        passar das demais.
      </p>

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <ListaDeFaixas
          titulo="Faixas de peso"
          unidade="kg"
          exemplo="De 2 a 3 kg"
          faixas={tabela.faixasPeso}
          onSalvar={(i, campos) => onSalvar("peso", i, campos)}
          onAdicionar={(rotulo, ate, final) => onAdicionar("peso", rotulo, ate, final)}
          onRemover={(i) => onRemover("peso", i)}
        />
        <ListaDeFaixas
          titulo="Faixas de preco"
          unidade="R$"
          exemplo="R$ 200 a R$ 249,99"
          faixas={tabela.faixasPreco}
          onSalvar={(i, campos) => onSalvar("preco", i, campos)}
          onAdicionar={(rotulo, ate, final) => onAdicionar("preco", rotulo, ate, final)}
          onRemover={(i) => onRemover("preco", i)}
        />
      </div>
    </section>
  );
}

function ListaDeFaixas({
  titulo,
  unidade,
  exemplo,
  faixas,
  onSalvar,
  onAdicionar,
  onRemover,
}: {
  titulo: string;
  unidade: string;
  exemplo: string;
  faixas: { rotulo: string; ate: number | null }[];
  onSalvar: (indice: number, campos: { rotulo?: string; ate?: number }) => Promise<boolean>;
  onAdicionar: (rotulo: string, ate: number, final: boolean) => Promise<boolean>;
  onRemover: (indice: number) => Promise<boolean>;
}) {
  const [confirmando, setConfirmando] = useState<number | null>(null);
  const [novoRotulo, setNovoRotulo] = useState("");
  const [novoAte, setNovoAte] = useState("");
  const [novaFinal, setNovaFinal] = useState(false);

  const ate = paraNumero(novoAte);
  const podeAdicionar = novoRotulo.trim() !== "" && ate !== null && ate > 0;
  const rotuloAnterior = faixas[faixas.length - 1]?.rotulo ?? "";

  const texto = (f: { ate: number | null }) =>
    f.ate === null ? "" : String(f.ate).replace(".", ",");

  return (
    <div>
      <h3 className="text-muted text-xs tracking-wide uppercase">
        {titulo} <span className="num">({faixas.length})</span>
      </h3>

      <div className="border-sage mt-2 max-h-72 overflow-y-auto rounded-[6px] border">
        {faixas.map((f, i) => (
          <div
            key={i}
            className="border-sage/50 flex items-center gap-2 border-b px-2 py-1.5 last:border-b-0"
          >
            <span className="num text-muted w-6 shrink-0 text-right text-xs">{i + 1}</span>

            <input
              defaultValue={f.rotulo}
              key={`r-${i}-${f.rotulo}`}
              onBlur={(e) => {
                const v = e.currentTarget.value.trim();
                if (v && v !== f.rotulo) void onSalvar(i, { rotulo: v });
                else e.currentTarget.value = f.rotulo;
              }}
              className="border-sage focus:border-signal min-w-0 flex-1 rounded-[4px] border px-2 py-1 text-sm"
            />

            <div className="flex shrink-0 items-center gap-1">
              <span className="text-muted text-xs">{unidade}</span>
              <input
                defaultValue={texto(f)}
                key={`a-${i}-${f.ate}`}
                inputMode="decimal"
                disabled={f.ate === null}
                title={f.ate === null ? "A ultima faixa nao tem teto" : "Teto desta faixa"}
                onInput={(e) => apenasNumero(e.currentTarget)}
                onBlur={(e) => {
                  const n = paraNumero(e.currentTarget.value);
                  if (n !== null && n !== f.ate) void onSalvar(i, { ate: n });
                  else e.currentTarget.value = texto(f);
                }}
                placeholder="sem teto"
                className="num border-sage focus:border-signal w-20 rounded-[4px] border px-1.5 py-1 text-right text-sm disabled:opacity-40"
              />
            </div>

            {confirmando === i ? (
              <span className="flex shrink-0 items-center gap-1">
                <button
                  onClick={async () => {
                    setConfirmando(null);
                    await onRemover(i);
                  }}
                  className="bg-alert rounded-[4px] px-1.5 py-0.5 text-[11px] font-medium text-white"
                >
                  remover
                </button>
                <button
                  onClick={() => setConfirmando(null)}
                  className="text-muted hover:text-ink text-[11px]"
                >
                  nao
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmando(i)}
                disabled={faixas.length <= 2}
                title={
                  faixas.length <= 2
                    ? "A tabela precisa de pelo menos duas faixas"
                    : "O intervalo desta faixa passa para a seguinte"
                }
                className="text-muted hover:text-alert shrink-0 text-[11px] underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-30"
              >
                remover
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Acrescentar: a posicao nao e escolhida, ela decorre do teto. */}
      <div className="border-sage mt-2 flex flex-wrap items-end gap-2 rounded-[6px] border border-dashed p-2">
        <label className="min-w-0 flex-1 text-sm">
          <span className="text-muted block text-xs">Nome da faixa nova</span>
          <input
            value={novoRotulo}
            onChange={(e) => setNovoRotulo(e.target.value)}
            placeholder={exemplo}
            className="border-sage focus:border-signal mt-1 w-full rounded-[4px] border px-2 py-1 text-sm"
          />
        </label>

        <label className="text-sm">
          <span className="text-muted block text-xs">
            {novaFinal ? `"${rotuloAnterior}" passa a terminar em` : "Limite"}
          </span>
          <div className="mt-1 flex items-center gap-1">
            <span className="text-muted text-xs">{unidade}</span>
            <input
              value={novoAte}
              inputMode="decimal"
              onInput={(e) => apenasNumero(e.currentTarget)}
              onChange={(e) => setNovoAte(e.target.value)}
              className="num border-sage focus:border-signal w-20 rounded-[4px] border px-1.5 py-1 text-right text-sm"
            />
          </div>
        </label>

        <button
          onClick={async () => {
            if (!podeAdicionar) return;
            const ok = await onAdicionar(novoRotulo.trim(), ate!, novaFinal);
            if (ok) {
              setNovoRotulo("");
              setNovoAte("");
              setNovaFinal(false);
            }
          }}
          disabled={!podeAdicionar}
          className="bg-signal rounded-[4px] px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Adicionar
        </button>

        {/* Sem esta opção não havia como estender o topo: toda faixa nova
            nascia com teto e ia parar antes da que recolhe o resto. */}
        <label className="flex w-full items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={novaFinal}
            onChange={(e) => setNovaFinal(e.target.checked)}
          />
          <span className={novaFinal ? "" : "text-muted"}>
            Esta é a nova última faixa, sem teto
          </span>
        </label>

        {novaFinal && (
          <p className="text-muted w-full text-xs">
            A faixa <strong>{rotuloAnterior}</strong> deixa de ser aberta e passa a terminar no
            limite acima. Renomeie-a depois, se o nome dela disser &ldquo;acima de&rdquo;.
          </p>
        )}
      </div>
    </div>
  );
}


/** A matriz: peso nas linhas, preço nas colunas, cada valor editável. */
function Matriz({
  tabela,
  destaque,
  onSalvar,
}: {
  tabela: TabelaFrete;
  destaque: { linha: number; coluna: number } | null;
  onSalvar: (linha: number, coluna: number, valor: number) => void | Promise<void>;
}) {
  return (
    <div className="border-sage bg-paper-raised max-h-[calc(100vh-20rem)] min-h-[20rem] overflow-auto rounded-[6px] border">
      {/* `w-full` com `table-fixed`: sem isso a tabela encolhe até a largura do
          conteúdo e sobra papel em branco à direita. A coluna dos rótulos de
          peso é a mais larga porque guarda textos como "De 100 a 125 kg". */}
      <table className="w-full table-fixed border-collapse text-xs">
        <colgroup>
          <col className="w-[15%]" />
          {tabela.faixasPreco.map((_, j) => (
            <col key={j} style={{ width: `${85 / tabela.faixasPreco.length}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {/* Canto: fixo nos dois eixos, senão cobre os rótulos ao rolar. */}
            <th className="bg-sage border-sage border-r-sage-deep text-muted sticky top-0 left-0 z-30 border-r border-b px-3 py-2 text-left font-medium">
              peso \ preço
            </th>
            {tabela.faixasPreco.map((f, j) => (
              <th
                key={j}
                className={`border-sage sticky top-0 z-20 border-b px-2 py-2 text-center font-medium whitespace-nowrap ${
                  destaque?.coluna === j ? "bg-signal-soft text-signal" : "bg-sage"
                }`}
              >
                {f.rotulo}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {tabela.faixasPeso.map((fp, i) => (
            <tr key={i} className="border-sage/40 even:bg-sage/20 border-b">
              <th
                scope="row"
                className={`border-sage border-r-sage-deep sticky left-0 z-10 border-r px-3 py-1 text-left font-normal whitespace-nowrap ${
                  destaque?.linha === i
                    ? "bg-signal-soft text-signal font-medium"
                    : "bg-paper-raised"
                }`}
              >
                {fp.rotulo}
              </th>

              {tabela.faixasPreco.map((_, j) => {
                const naCruz = destaque?.linha === i && destaque?.coluna === j;
                const naLinha = destaque?.linha === i || destaque?.coluna === j;
                return (
                  <td
                    key={j}
                    className={`px-1 py-1 ${naCruz ? "bg-signal/20" : naLinha ? "bg-signal-soft/50" : ""}`}
                  >
                    <input
                      defaultValue={emReais(tabela.valores[i]?.[j] ?? 0)}
                      key={`v-${i}-${j}-${tabela.valores[i]?.[j]}`}
                      inputMode="decimal"
                      onInput={(e) => apenasNumero(e.currentTarget)}
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={(e) => {
                        const n = paraNumero(e.currentTarget.value);
                        const atual = tabela.valores[i]?.[j] ?? 0;
                        if (n !== null && n >= 0 && Math.abs(n - atual) > 0.0001) {
                          void onSalvar(i, j, n);
                        } else {
                          e.currentTarget.value = emReais(atual);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                      className={`num w-full rounded-[4px] border px-1.5 py-1 text-right focus:border-signal ${
                        naCruz ? "border-signal bg-paper-raised font-semibold" : "border-sage"
                      }`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
