"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  calcular,
  precoParaMargem,
  type Parametros,
  type Resultado,
  type TabelaFrete,
  type TipoCanal,
} from "@/lib/precificacao";

type CanalSalvo = {
  id: number;
  nome: string;
  tipo: TipoCanal;
  imposto: number;
  antecipacaoAtiva: boolean;
  embalagemAtiva: boolean;
  promocao: number;
  ativo: boolean;
};

type Modalidade = "classico" | "premium" | "unico";

type LinhaAnuncio = {
  anuncioId: number;
  sku: string;
  modalidade: Modalidade;
  comissao: number;
  taxaFixa: number;
  preco: number;
  nome: string;
  marca: string | null;
  temProduto: boolean;
  custo: number;
  peso: number;
  saldo: number;
};

type Contexto = {
  parametros: Parametros;
  canais: CanalSalvo[];
  canalAtual: number | null;
  tabelaFrete: TabelaFrete;
  anuncios: LinhaAnuncio[];
};

type Disponivel = {
  sku: string;
  nome: string;
  marca: string | null;
  custo: number;
  peso: number;
  saldo: number;
};

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const inteiro = new Intl.NumberFormat("pt-BR");

const pct = (fracao: number, casas = 2) =>
  `${(fracao * 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: casas,
  })}%`;

/** Aceita "32,5" e "32.5" — teclado brasileiro usa vírgula. */
function paraNumero(texto: string): number | null {
  const limpo = texto.trim().replace(/\./g, "").replace(",", ".");
  if (limpo === "") return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

/** Uma linha da tela: o produto e suas modalidades lado a lado. */
type LinhaAgrupada = {
  sku: string;
  nome: string;
  marca: string | null;
  temProduto: boolean;
  custo: number;
  peso: number;
  saldo: number;
  porModalidade: Partial<Record<Modalidade, LinhaAnuncio>>;
};

function agrupar(anuncios: LinhaAnuncio[]): LinhaAgrupada[] {
  const mapa = new Map<string, LinhaAgrupada>();
  for (const a of anuncios) {
    let linha = mapa.get(a.sku);
    if (!linha) {
      linha = {
        sku: a.sku,
        nome: a.nome,
        marca: a.marca,
        temProduto: a.temProduto,
        custo: a.custo,
        peso: a.peso,
        saldo: a.saldo,
        porModalidade: {},
      };
      mapa.set(a.sku, linha);
    }
    linha.porModalidade[a.modalidade] = a;
  }
  return [...mapa.values()];
}

export default function Precificacao() {
  const [contexto, setContexto] = useState<Contexto | null>(null);
  const [canalId, setCanalId] = useState<number | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(0);

  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("");
  const [disponiveis, setDisponiveis] = useState<Disponivel[]>([]);
  const [totalDisponiveis, setTotalDisponiveis] = useState(0);
  const [mostrarDisponiveis, setMostrarDisponiveis] = useState(false);

  // --- carregamento --------------------------------------------------------

  const carregar = useCallback(async (id?: number | null) => {
    setCarregando(true);
    setErro(null);
    try {
      const url = id ? `/api/precificacao/contexto?canal=${id}` : "/api/precificacao/contexto";
      const r = await fetch(url);
      const dados = await r.json();
      if (!r.ok) throw new Error(dados.erro ?? "Não foi possível carregar.");
      setContexto(dados);
      setCanalId(dados.canalAtual);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Busca com espera: só consulta depois que a digitação para.
  useEffect(() => {
    const t = setTimeout(() => setFiltro(busca), 300);
    return () => clearTimeout(t);
  }, [busca]);

  useEffect(() => {
    if (!canalId || !mostrarDisponiveis) return;
    let cancelado = false;
    (async () => {
      try {
        const r = await fetch(
          `/api/precificacao/disponiveis?canal=${canalId}&q=${encodeURIComponent(filtro)}`
        );
        const dados = await r.json();
        if (cancelado || !r.ok) return;
        setDisponiveis(dados.produtos);
        setTotalDisponiveis(dados.total);
      } catch {
        /* a busca é acessória: falhar aqui não derruba a tela */
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [canalId, filtro, mostrarDisponiveis]);

  const canal = useMemo(
    () => contexto?.canais.find((c) => c.id === canalId) ?? null,
    [contexto, canalId]
  );

  const linhas = useMemo(
    () => (contexto ? agrupar(contexto.anuncios) : []),
    [contexto]
  );

  // --- cálculo -------------------------------------------------------------

  const calcularLinha = useCallback(
    (linha: LinhaAgrupada, anuncio: LinhaAnuncio): Resultado | null => {
      if (!contexto || !canal) return null;
      return calcular(
        { custo: linha.custo, peso: linha.peso },
        canal,
        { comissao: anuncio.comissao, taxaFixa: anuncio.taxaFixa, preco: anuncio.preco },
        contexto.parametros,
        contexto.tabelaFrete
      );
    },
    [contexto, canal]
  );

  // --- escrita -------------------------------------------------------------

  /** Altera o anúncio na tela na hora e envia ao servidor em segundo plano. */
  const aplicar = useCallback(
    async (anuncioId: number, campos: { comissao?: number; taxaFixa?: number; preco?: number }) => {
      setContexto((antes) =>
        antes
          ? {
              ...antes,
              anuncios: antes.anuncios.map((a) =>
                a.anuncioId === anuncioId ? { ...a, ...campos } : a
              ),
            }
          : antes
      );

      setSalvando((n) => n + 1);
      try {
        const r = await fetch("/api/precificacao/anuncios", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ anuncioId, ...campos }),
        });
        if (!r.ok) {
          const dados = await r.json();
          throw new Error(dados.erro ?? "Não foi possível salvar.");
        }
        setErro(null);
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e));
        void carregar(canalId);
      } finally {
        setSalvando((n) => n - 1);
      }
    },
    [canalId, carregar]
  );

  /** Caminho inverso: a margem digitada vira preço. */
  const aplicarMargem = useCallback(
    (linha: LinhaAgrupada, anuncio: LinhaAnuncio, margemAlvo: number) => {
      if (!contexto || !canal) return;
      const sugerido = precoParaMargem(
        { custo: linha.custo, peso: linha.peso },
        canal,
        { comissao: anuncio.comissao, taxaFixa: anuncio.taxaFixa },
        contexto.parametros,
        contexto.tabelaFrete,
        margemAlvo
      );
      if (!sugerido) {
        setErro(
          `Não existe preço que alcance ${pct(margemAlvo)} em ${linha.nome}: ` +
            `comissão, promoção e imposto consomem tudo que entra.`
        );
        return;
      }
      const preco = Math.round(sugerido.preco * 100) / 100;
      void aplicar(anuncio.anuncioId, { preco });
      if (sugerido.aproximado) {
        setErro(
          `Em ${linha.nome}, o preço para ${pct(margemAlvo)} cai num degrau da tabela de ` +
            `frete. Usei ${moeda.format(preco)}, o mais próximo possível.`
        );
      }
    },
    [contexto, canal, aplicar]
  );

  const adicionar = useCallback(
    async (sku: string) => {
      if (!canalId) return;
      setSalvando((n) => n + 1);
      try {
        const r = await fetch("/api/precificacao/anuncios", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ canalId, sku }),
        });
        if (!r.ok) {
          const dados = await r.json();
          throw new Error(dados.erro ?? "Não foi possível adicionar.");
        }
        await carregar(canalId);
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e));
      } finally {
        setSalvando((n) => n - 1);
      }
    },
    [canalId, carregar]
  );

  const remover = useCallback(
    async (sku: string, nome: string) => {
      if (!canalId) return;
      if (!confirm(`Deixar de anunciar "${nome}" neste canal?\n\nO preço cadastrado será perdido.`)) {
        return;
      }
      setSalvando((n) => n + 1);
      try {
        const r = await fetch("/api/precificacao/anuncios", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ canalId, sku }),
        });
        if (!r.ok) {
          const dados = await r.json();
          throw new Error(dados.erro ?? "Não foi possível remover.");
        }
        await carregar(canalId);
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e));
      } finally {
        setSalvando((n) => n - 1);
      }
    },
    [canalId, carregar]
  );

  const ajustarCanal = useCallback(
    async (campos: Partial<Pick<CanalSalvo, "imposto" | "antecipacaoAtiva" | "embalagemAtiva" | "promocao">>) => {
      if (!canal) return;
      const novo = { ...canal, ...campos };
      setContexto((antes) =>
        antes
          ? { ...antes, canais: antes.canais.map((c) => (c.id === novo.id ? novo : c)) }
          : antes
      );
      setSalvando((n) => n + 1);
      try {
        const r = await fetch("/api/precificacao/canais", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: novo.id,
            imposto: novo.imposto,
            antecipacaoAtiva: novo.antecipacaoAtiva,
            embalagemAtiva: novo.embalagemAtiva,
            promocao: novo.promocao,
          }),
        });
        if (!r.ok) {
          const dados = await r.json();
          throw new Error(dados.erro ?? "Não foi possível salvar o canal.");
        }
        setErro(null);
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e));
        void carregar(canalId);
      } finally {
        setSalvando((n) => n - 1);
      }
    },
    [canal, canalId, carregar]
  );

  // --- resumo --------------------------------------------------------------

  const resumo = useMemo(() => {
    if (!contexto || !canal) return null;
    let comPreco = 0;
    let prejuizo = 0;
    let somaMargem = 0;
    for (const linha of linhas) {
      for (const anuncio of Object.values(linha.porModalidade)) {
        if (!anuncio || anuncio.preco <= 0) continue;
        const r = calcularLinha(linha, anuncio);
        if (!r) continue;
        comPreco++;
        if (r.lucro < 0) prejuizo++;
        if (r.margem !== null) somaMargem += r.margem;
      }
    }
    return {
      anuncios: comPreco,
      prejuizo,
      margemMedia: comPreco > 0 ? somaMargem / comPreco : 0,
    };
  }, [contexto, canal, linhas, calcularLinha]);

  const modalidades: Modalidade[] = canal?.tipo === "ml" ? ["classico", "premium"] : ["unico"];
  const rotuloModalidade: Record<Modalidade, string> = {
    classico: "Clássico",
    premium: "Premium",
    unico: "Anúncio",
  };

  // --- tela ----------------------------------------------------------------

  return (
    <main className="min-h-screen">
      <header className="bg-ink text-paper">
        <div className="mx-auto max-w-[1600px] px-6 py-10 sm:px-8">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <a href="/" className="text-sage-deep text-sm underline underline-offset-4">
                ← Catálogo HMD
              </a>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                Precificação
              </h1>
              <p className="text-sage-deep mt-2 text-sm">
                {carregando
                  ? "Carregando…"
                  : resumo
                    ? `${inteiro.format(resumo.anuncios)} anúncios com preço · margem média ${pct(resumo.margemMedia, 1)}` +
                      (resumo.prejuizo > 0 ? ` · ${resumo.prejuizo} no prejuízo` : "")
                    : "Nenhum canal cadastrado"}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 pb-1">
              {salvando > 0 && <span className="text-sage-deep text-sm">Salvando…</span>}
              <select
                value={canalId ?? ""}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  setCanalId(id);
                  setMostrarDisponiveis(false);
                  void carregar(id);
                }}
                className="border-ink-line bg-ink-soft text-paper rounded-[6px] border px-3 py-2.5 text-sm"
              >
                {contexto?.canais.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome} · {c.tipo === "ml" ? "Mercado Livre" : "Shopee"}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-6 py-8 sm:px-8">
        {erro && (
          <div className="bg-alert-soft text-alert mb-6 flex items-start justify-between gap-4 rounded-[6px] px-4 py-3 text-sm">
            <span>{erro}</span>
            <button onClick={() => setErro(null)} className="shrink-0 underline underline-offset-4">
              fechar
            </button>
          </div>
        )}

        {canal && (
          <section className="bg-paper-raised mb-8 rounded-[6px] border border-sage p-5">
            <h2 className="text-sm font-semibold">Chaves deste canal</h2>
            <p className="text-muted mt-1 text-sm">
              Valem para todos os anúncios de {canal.nome}. Era a linha 6 da aba na planilha.
            </p>
            <div className="mt-4 flex flex-wrap items-end gap-6">
              <label className="text-sm">
                <span className="text-muted block">Imposto</span>
                <div className="mt-1 flex items-center gap-1">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    defaultValue={(canal.imposto * 100).toString()}
                    onBlur={(e) => {
                      const n = paraNumero(e.target.value);
                      if (n !== null) void ajustarCanal({ imposto: n / 100 });
                    }}
                    className="num border-sage w-24 rounded-[6px] border px-2 py-1.5 text-right"
                  />
                  <span className="text-muted">%</span>
                </div>
              </label>

              <label className="text-sm">
                <span className="text-muted block">Promoção</span>
                <div className="mt-1 flex items-center gap-1">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    defaultValue={(canal.promocao * 100).toString()}
                    onBlur={(e) => {
                      const n = paraNumero(e.target.value);
                      if (n !== null) void ajustarCanal({ promocao: n / 100 });
                    }}
                    className="num border-sage w-24 rounded-[6px] border px-2 py-1.5 text-right"
                  />
                  <span className="text-muted">%</span>
                </div>
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={canal.antecipacaoAtiva}
                  onChange={(e) => void ajustarCanal({ antecipacaoAtiva: e.target.checked })}
                />
                Antecipação ({pct(contexto?.parametros.antecipacao ?? 0)})
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={canal.embalagemAtiva}
                  onChange={(e) => void ajustarCanal({ embalagemAtiva: e.target.checked })}
                />
                Embalagem ({moeda.format(contexto?.parametros.embalagem ?? 0)})
              </label>
            </div>
          </section>
        )}

        <section>
          <h2 className="text-lg font-semibold">
            Anunciados neste canal{" "}
            <span className="text-muted font-normal">({inteiro.format(linhas.length)})</span>
          </h2>

          {carregando ? (
            <p className="text-muted mt-4 text-sm">Carregando…</p>
          ) : linhas.length === 0 ? (
            <p className="text-muted mt-4 text-sm">
              Nenhum produto anunciado aqui ainda. Use a lista abaixo para adicionar.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-sage border-b text-left">
                    <th className="py-2 pr-3 font-medium">Produto</th>
                    <th className="py-2 pr-3 text-right font-medium">Custo</th>
                    <th className="py-2 pr-3 text-right font-medium">Peso</th>
                    {modalidades.map((m) => (
                      <th
                        key={m}
                        colSpan={6}
                        className="border-sage border-l py-2 pl-3 pr-3 text-center font-medium"
                      >
                        {rotuloModalidade[m]}
                      </th>
                    ))}
                    <th className="py-2 pl-3" />
                  </tr>
                  <tr className="border-sage text-muted border-b text-left text-xs">
                    <th className="py-2 pr-3 font-normal" />
                    <th className="py-2 pr-3 font-normal" />
                    <th className="py-2 pr-3 font-normal" />
                    {modalidades.map((m) => (
                      <Fragment key={m}>
                        <th className="border-sage border-l py-2 pl-3 pr-3 text-right font-normal">
                          % taxa
                        </th>
                        <th className="py-2 pr-3 text-right font-normal">Preço</th>
                        <th className="py-2 pr-3 text-right font-normal">Frete</th>
                        <th className="py-2 pr-3 text-right font-normal">Comissão</th>
                        <th className="py-2 pr-3 text-right font-normal">Lucro</th>
                        <th className="py-2 pr-3 text-right font-normal">Margem</th>
                      </Fragment>
                    ))}
                    <th className="py-2 pl-3 font-normal" />
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((linha) => (
                    <tr key={linha.sku} className="border-sage/60 border-b align-middle">
                      <td className="py-2 pr-3">
                        <span className="font-medium">{linha.nome}</span>
                        <span className="text-muted block text-xs">
                          {linha.sku}
                          {linha.marca ? ` · ${linha.marca}` : ""}
                          {!linha.temProduto && (
                            <span className="text-alert"> · fora do catálogo do Bling</span>
                          )}
                        </span>
                      </td>
                      <td className="num py-2 pr-3 text-right">
                        {linha.temProduto ? moeda.format(linha.custo) : "—"}
                      </td>
                      <td className="num text-muted py-2 pr-3 text-right">
                        {linha.temProduto ? `${linha.peso.toLocaleString("pt-BR")} kg` : "—"}
                      </td>

                      {modalidades.map((m) => {
                        const anuncio = linha.porModalidade[m];
                        if (!anuncio) {
                          return (
                            <td
                              key={m}
                              colSpan={6}
                              className="border-sage text-muted border-l py-2 pl-3 text-center text-xs"
                            >
                              sem anúncio
                            </td>
                          );
                        }
                        const r = calcularLinha(linha, anuncio);
                        const prejuizo = r !== null && anuncio.preco > 0 && r.lucro < 0;

                        return (
                          <CelulasModalidade
                            key={m}
                            anuncio={anuncio}
                            resultado={r}
                            prejuizo={prejuizo}
                            desabilitado={!linha.temProduto}
                            onComissao={(v) => void aplicar(anuncio.anuncioId, { comissao: v })}
                            onPreco={(v) => void aplicar(anuncio.anuncioId, { preco: v })}
                            onMargem={(v) => aplicarMargem(linha, anuncio, v)}
                          />
                        );
                      })}

                      <td className="py-2 pl-3 text-right">
                        <button
                          onClick={() => void remover(linha.sku, linha.nome)}
                          className="text-muted hover:text-alert text-xs underline underline-offset-4"
                        >
                          remover
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-12">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">Disponíveis para anunciar</h2>
            <button
              onClick={() => setMostrarDisponiveis((v) => !v)}
              className="border-sage rounded-[6px] border px-4 py-2 text-sm font-medium hover:bg-sage/40"
            >
              {mostrarDisponiveis ? "Ocultar" : "Mostrar catálogo"}
            </button>
          </div>

          {mostrarDisponiveis && (
            <>
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome ou código…"
                className="border-sage mt-4 w-full max-w-md rounded-[6px] border px-3 py-2 text-sm"
              />
              <p className="text-muted mt-2 text-sm">
                {inteiro.format(totalDisponiveis)} produtos do catálogo ainda não anunciados aqui
                {totalDisponiveis > disponiveis.length && ` · mostrando os ${disponiveis.length} primeiros`}
              </p>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-sage text-muted border-b text-left text-xs">
                      <th className="py-2 pr-3 font-normal">Produto</th>
                      <th className="py-2 pr-3 text-right font-normal">Custo</th>
                      <th className="py-2 pr-3 text-right font-normal">Peso</th>
                      <th className="py-2 pr-3 text-right font-normal">Saldo</th>
                      <th className="py-2 pl-3 font-normal" />
                    </tr>
                  </thead>
                  <tbody>
                    {disponiveis.map((p) => (
                      <tr key={p.sku} className="border-sage/60 border-b">
                        <td className="py-2 pr-3">
                          <span className="font-medium">{p.nome}</span>
                          <span className="text-muted block text-xs">
                            {p.sku}
                            {p.marca ? ` · ${p.marca}` : ""}
                          </span>
                        </td>
                        <td className="num py-2 pr-3 text-right">{moeda.format(p.custo)}</td>
                        <td className="num text-muted py-2 pr-3 text-right">
                          {p.peso.toLocaleString("pt-BR")} kg
                        </td>
                        <td className="num text-muted py-2 pr-3 text-right">
                          {inteiro.format(p.saldo)}
                        </td>
                        <td className="py-2 pl-3 text-right">
                          <button
                            onClick={() => void adicionar(p.sku)}
                            className="bg-signal rounded-[6px] px-3 py-1.5 text-xs font-medium text-white hover:brightness-110"
                          >
                            Anunciar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {disponiveis.length === 0 && (
                  <p className="text-muted mt-4 text-sm">Nenhum produto encontrado.</p>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

/**
 * As seis colunas de uma modalidade. Preço e Margem são os dois lados da
 * mesma conta: digitar um recalcula o outro.
 */
function CelulasModalidade({
  anuncio,
  resultado,
  prejuizo,
  desabilitado,
  onComissao,
  onPreco,
  onMargem,
}: {
  anuncio: LinhaAnuncio;
  resultado: Resultado | null;
  prejuizo: boolean;
  desabilitado: boolean;
  onComissao: (valor: number) => void;
  onPreco: (valor: number) => void;
  onMargem: (valor: number) => void;
}) {
  const semPreco = anuncio.preco <= 0;

  return (
    <>
      <td className="border-sage border-l py-2 pl-3 pr-3 text-right">
        <input
          type="number"
          step="0.01"
          min="0"
          max="100"
          disabled={desabilitado}
          value={Number((anuncio.comissao * 100).toFixed(2))}
          onChange={(e) => {
            const n = paraNumero(e.target.value);
            if (n !== null) onComissao(n / 100);
          }}
          className="num border-sage w-16 rounded-[6px] border px-1.5 py-1 text-right disabled:opacity-40"
        />
      </td>
      <td className="py-2 pr-3 text-right">
        <input
          type="number"
          step="0.01"
          min="0"
          disabled={desabilitado}
          defaultValue={anuncio.preco > 0 ? anuncio.preco : ""}
          key={`preco-${anuncio.anuncioId}-${anuncio.preco}`}
          onBlur={(e) => {
            const n = paraNumero(e.target.value);
            if (n !== null && n !== anuncio.preco) onPreco(n);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="num border-sage w-24 rounded-[6px] border px-1.5 py-1 text-right disabled:opacity-40"
        />
      </td>
      <td className="num text-muted py-2 pr-3 text-right">
        {resultado && !semPreco ? moeda.format(resultado.frete) : "—"}
      </td>
      <td className="num text-muted py-2 pr-3 text-right">
        {resultado && !semPreco ? moeda.format(resultado.comissao) : "—"}
      </td>
      <td className={`num py-2 pr-3 text-right ${prejuizo ? "text-alert font-medium" : ""}`}>
        {resultado && !semPreco ? moeda.format(resultado.lucro) : "—"}
      </td>
      <td className="py-2 pr-3 text-right">
        <input
          type="number"
          step="1"
          disabled={desabilitado}
          defaultValue={
            resultado?.margem !== null && resultado !== null && !semPreco
              ? Number((resultado.margem * 100).toFixed(1))
              : ""
          }
          key={`margem-${anuncio.anuncioId}-${anuncio.preco}`}
          onBlur={(e) => {
            const n = paraNumero(e.target.value);
            if (n === null) return;
            const atual = resultado?.margem !== null && resultado ? resultado.margem * 100 : null;
            if (atual !== null && Math.abs(n - atual) < 0.05) return;
            onMargem(n / 100);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          title="Digite a margem que você quer e o preço se ajusta"
          className={`num border-sage w-20 rounded-[6px] border px-1.5 py-1 text-right disabled:opacity-40 ${
            prejuizo ? "text-alert font-medium" : ""
          }`}
        />
      </td>
    </>
  );
}
