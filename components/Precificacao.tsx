"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  calcular,
  precoParaMargem,
  type Resultado,
  type TabelaFrete,
  type TipoCanal,
} from "@/lib/precificacao";
import { paraNumero } from "@/lib/numero";

type CanalSalvo = {
  id: number;
  nome: string;
  tipo: TipoCanal;
  imposto: number;
  antecipacao: number;
  embalagem: number;
  promocaoPadrao: number;
  ativo: boolean;
};

type Modalidade = "classico" | "premium" | "unico";
type Situacao = "todos" | "anunciados" | "disponiveis";

type AnuncioLinha = {
  anuncioId: number;
  modalidade: Modalidade;
  comissao: number;
  taxaFixa: number;
  preco: number;
  promocao: number;
};

type Linha = {
  sku: string;
  nome: string;
  marca: string | null;
  temProduto: boolean;
  custo: number;
  peso: number;
  saldo: number;
  anunciado: boolean;
  anuncios: AnuncioLinha[];
};

type Contexto = {
  canais: CanalSalvo[];
  canalAtual: number | null;
  tabelaFrete: TabelaFrete;
  produtosNoCatalogo: number;
};

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const inteiro = new Intl.NumberFormat("pt-BR");

const pct = (fracao: number, casas = 1) =>
  `${(fracao * 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: casas,
  })}%`;

const ROTULO: Record<Modalidade, string> = {
  classico: "Clássico",
  premium: "Premium",
  unico: "Anúncio",
};

const SITUACOES: { id: Situacao; rotulo: string }[] = [
  { id: "todos", rotulo: "Todos" },
  { id: "anunciados", rotulo: "Anunciados" },
  { id: "disponiveis", rotulo: "Não anunciados" },
];

export default function Precificacao() {
  const [contexto, setContexto] = useState<Contexto | null>(null);
  const [canalId, setCanalId] = useState<number | null>(null);

  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(50);

  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("");
  const [situacao, setSituacao] = useState<Situacao>("todos");

  const [carregandoContexto, setCarregandoContexto] = useState(true);
  const [carregandoLinhas, setCarregandoLinhas] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(0);

  const pedido = useRef(0);

  // --- carregamento --------------------------------------------------------

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/precificacao/contexto");
        const dados = await r.json();
        if (!r.ok) throw new Error(dados.erro ?? "Não foi possível carregar.");
        setContexto(dados);
        setCanalId(dados.canalAtual);
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e));
      } finally {
        setCarregandoContexto(false);
      }
    })();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setFiltro(busca);
      setPagina(1);
    }, 300);
    return () => clearTimeout(t);
  }, [busca]);

  const buscarLinhas = useCallback(async () => {
    if (!canalId) return;
    const meu = ++pedido.current;
    setCarregandoLinhas(true);
    try {
      const url =
        `/api/precificacao/linhas?canal=${canalId}` +
        `&q=${encodeURIComponent(filtro)}&situacao=${situacao}&pagina=${pagina}`;
      const r = await fetch(url);
      const dados = await r.json();
      // Uma resposta antiga não pode sobrescrever uma busca mais recente.
      if (meu !== pedido.current) return;
      if (!r.ok) throw new Error(dados.erro ?? "Não foi possível carregar a lista.");
      setLinhas(dados.linhas);
      setTotal(dados.total);
      setPorPagina(dados.porPagina);
    } catch (e) {
      if (meu === pedido.current) setErro(e instanceof Error ? e.message : String(e));
    } finally {
      if (meu === pedido.current) setCarregandoLinhas(false);
    }
  }, [canalId, filtro, situacao, pagina]);

  useEffect(() => {
    void buscarLinhas();
  }, [buscarLinhas]);

  const canal = useMemo(
    () => contexto?.canais.find((c) => c.id === canalId) ?? null,
    [contexto, canalId]
  );

  const modalidades: Modalidade[] = canal?.tipo === "ml" ? ["classico", "premium"] : ["unico"];
  const semCatalogo = (contexto?.produtosNoCatalogo ?? 0) === 0;

  // --- cálculo -------------------------------------------------------------

  const calcularAnuncio = useCallback(
    (linha: Linha, anuncio: AnuncioLinha): Resultado | null => {
      if (!contexto || !canal) return null;
      return calcular(
        { custo: linha.custo, peso: linha.peso },
        canal,
        {
          comissao: anuncio.comissao,
          taxaFixa: anuncio.taxaFixa,
          preco: anuncio.preco,
          promocao: anuncio.promocao,
        },
        contexto.tabelaFrete
      );
    },
    [contexto, canal]
  );

  // --- escrita -------------------------------------------------------------

  const aplicar = useCallback(
    async (anuncioId: number, campos: Partial<Pick<AnuncioLinha, "comissao" | "taxaFixa" | "preco" | "promocao">>) => {
      setLinhas((antes) =>
        antes.map((l) => ({
          ...l,
          anuncios: l.anuncios.map((a) => (a.anuncioId === anuncioId ? { ...a, ...campos } : a)),
        }))
      );

      setSalvando((n) => n + 1);
      try {
        const r = await fetch("/api/precificacao/anuncios", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ anuncioId, ...campos }),
        });
        if (!r.ok) throw new Error((await r.json()).erro ?? "Não foi possível salvar.");
        setErro(null);
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e));
        void buscarLinhas();
      } finally {
        setSalvando((n) => n - 1);
      }
    },
    [buscarLinhas]
  );

  const aplicarMargem = useCallback(
    (linha: Linha, anuncio: AnuncioLinha, margemAlvo: number) => {
      if (!contexto || !canal) return;
      if (linha.custo <= 0) {
        setErro(
          `Sem o custo de ${linha.nome} não dá para calcular o preço de uma margem. ` +
            `Leia o catálogo do Bling primeiro.`
        );
        return;
      }
      const sugerido = precoParaMargem(
        { custo: linha.custo, peso: linha.peso },
        canal,
        { comissao: anuncio.comissao, taxaFixa: anuncio.taxaFixa, promocao: anuncio.promocao },
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
      setErro(
        sugerido.aproximado
          ? `Em ${linha.nome}, o preço para ${pct(margemAlvo)} cai num degrau da tabela de ` +
              `frete. Usei ${moeda.format(preco)}, o mais próximo possível.`
          : null
      );
    },
    [contexto, canal, aplicar]
  );

  const anunciar = useCallback(
    async (sku: string) => {
      if (!canalId) return;
      setSalvando((n) => n + 1);
      try {
        const r = await fetch("/api/precificacao/anuncios", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ canalId, sku }),
        });
        if (!r.ok) throw new Error((await r.json()).erro ?? "Não foi possível adicionar.");
        await buscarLinhas();
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e));
      } finally {
        setSalvando((n) => n - 1);
      }
    },
    [canalId, buscarLinhas]
  );

  const remover = useCallback(
    async (sku: string, nome: string) => {
      if (!canalId) return;
      if (!confirm(`Deixar de anunciar "${nome}" nesta conta?\n\nO preço cadastrado será perdido.`)) return;
      setSalvando((n) => n + 1);
      try {
        const r = await fetch("/api/precificacao/anuncios", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ canalId, sku }),
        });
        if (!r.ok) throw new Error((await r.json()).erro ?? "Não foi possível remover.");
        await buscarLinhas();
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e));
      } finally {
        setSalvando((n) => n - 1);
      }
    },
    [canalId, buscarLinhas]
  );

  // --- resumo da página ----------------------------------------------------

  const resumo = useMemo(() => {
    let comPreco = 0;
    let prejuizo = 0;
    let soma = 0;
    for (const linha of linhas) {
      for (const anuncio of linha.anuncios) {
        if (anuncio.preco <= 0) continue;
        const r = calcularAnuncio(linha, anuncio);
        if (!r) continue;
        comPreco++;
        if (r.lucro < 0) prejuizo++;
        if (r.margem !== null) soma += r.margem;
      }
    }
    return { comPreco, prejuizo, margemMedia: comPreco ? soma / comPreco : 0 };
  }, [linhas, calcularAnuncio]);

  const ultimaPagina = Math.max(1, Math.ceil(total / porPagina));

  // --- tela ----------------------------------------------------------------

  return (
    <main className="min-h-screen">
      <header className="bg-ink text-paper">
        <div className="mx-auto max-w-[1600px] px-6 py-9 sm:px-8">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Precificação</h1>
              <p className="text-sage-deep mt-2 text-sm">
                {carregandoContexto
                  ? "Carregando…"
                  : canal
                    ? `${canal.nome} · ${canal.tipo === "ml" ? "Mercado Livre" : "Shopee"} · ` +
                      `imposto ${pct(canal.imposto)} · antecipação ${pct(canal.antecipacao)} · ` +
                      `embalagem ${moeda.format(canal.embalagem)}`
                    : "Nenhuma conta cadastrada"}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {salvando > 0 && <span className="text-sage-deep text-sm">Salvando…</span>}
              <label className="text-sage-deep text-sm">
                <span className="sr-only">Conta de anúncio</span>
                <select
                  value={canalId ?? ""}
                  onChange={(e) => {
                    setCanalId(Number(e.target.value));
                    setPagina(1);
                  }}
                  className="border-ink-line bg-ink-soft text-paper rounded-[6px] border px-3 py-2.5 text-sm"
                >
                  {contexto?.canais.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome} · {c.tipo === "ml" ? "Mercado Livre" : "Shopee"}
                    </option>
                  ))}
                </select>
              </label>
              <a
                href="/contas"
                className="border-ink-line rounded-[6px] border px-4 py-2.5 text-sm font-medium hover:bg-ink-soft"
              >
                Editar conta
              </a>
            </div>
          </div>

        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-6 py-8 sm:px-8">
        {semCatalogo && (
          <div className="bg-amber-soft text-amber mb-6 rounded-[6px] px-4 py-3 text-sm">
            O catálogo do Bling ainda não foi lido neste ambiente. Você pode cadastrar preços
            normalmente, mas <strong>lucro e margem só aparecem depois</strong> que houver custo e
            peso. Abra o <a href="/catalogo" className="underline underline-offset-4">Catálogo</a> e
            clique em Ler catálogo agora.
          </div>
        )}

        {erro && (
          <div className="bg-alert-soft text-alert mb-6 flex items-start justify-between gap-4 rounded-[6px] px-4 py-3 text-sm">
            <span>{erro}</span>
            <button onClick={() => setErro(null)} className="shrink-0 underline underline-offset-4">
              fechar
            </button>
          </div>
        )}

        {/* Barra de filtros */}
        <div className="border-sage bg-paper-raised sticky top-0 z-10 mb-5 flex flex-wrap items-center gap-4 rounded-[6px] border px-4 py-3">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, SKU ou marca…"
            className="border-sage min-w-56 flex-1 rounded-[6px] border px-3 py-2 text-sm"
          />

          <div className="border-sage flex overflow-hidden rounded-[6px] border" role="group">
            {SITUACOES.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setSituacao(s.id);
                  setPagina(1);
                }}
                aria-pressed={situacao === s.id}
                className={`px-3 py-2 text-sm transition-colors ${
                  situacao === s.id
                    ? "bg-signal font-medium text-white"
                    : "text-muted hover:bg-sage/40"
                }`}
              >
                {s.rotulo}
              </button>
            ))}
          </div>

          <p className="text-muted num text-sm">
            {carregandoLinhas ? "buscando…" : `${inteiro.format(total)} produtos`}
            {resumo.comPreco > 0 && (
              <>
                {" · "}margem média {pct(resumo.margemMedia)}
                {resumo.prejuizo > 0 && (
                  <span className="text-alert"> · {resumo.prejuizo} no prejuízo</span>
                )}
              </>
            )}
          </p>
        </div>

        {/* Tabela */}
        <div className="border-sage bg-paper-raised overflow-x-auto rounded-[6px] border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-sage bg-sage/30 border-b">
                <th className="px-4 py-2.5 text-left font-medium">Produto</th>
                <th className="px-3 py-2.5 text-right font-medium">Custo</th>
                <th className="px-3 py-2.5 text-right font-medium">Peso</th>
                {modalidades.map((m) => (
                  <th
                    key={m}
                    colSpan={7}
                    className="border-sage border-l px-3 py-2.5 text-center font-medium"
                  >
                    {ROTULO[m]}
                  </th>
                ))}
                <th className="px-3 py-2.5" />
              </tr>
              <tr className="border-sage text-muted border-b text-xs">
                <th className="px-4 py-2 text-left font-normal">SKU · marca</th>
                <th className="px-3 py-2 text-right font-normal">R$</th>
                <th className="px-3 py-2 text-right font-normal">kg</th>
                {modalidades.map((m) => (
                  <Fragment key={m}>
                    <th className="border-sage border-l px-2 py-2 text-right font-normal">% taxa</th>
                    <th className="px-2 py-2 text-right font-normal">% promo</th>
                    <th className="px-2 py-2 text-right font-normal">Preço</th>
                    <th className="px-2 py-2 text-right font-normal">Frete</th>
                    <th className="px-2 py-2 text-right font-normal">Comissão</th>
                    <th className="px-2 py-2 text-right font-normal">Lucro</th>
                    <th className="px-2 py-2 text-right font-normal">Margem</th>
                  </Fragment>
                ))}
                <th className="px-3 py-2 font-normal" />
              </tr>
            </thead>

            <tbody>
              {linhas.length === 0 && !carregandoLinhas && (
                <tr>
                  <td colSpan={4 + modalidades.length * 7} className="text-muted px-4 py-10 text-center">
                    Nenhum produto encontrado com esses filtros.
                  </td>
                </tr>
              )}

              {linhas.map((linha) => (
                <tr key={linha.sku} className="border-sage/50 hover:bg-sage/15 border-b">
                  <td className="px-4 py-2">
                    <span className="font-medium">{linha.nome}</span>
                    <span className="text-muted block text-xs">
                      {linha.sku}
                      {linha.marca ? ` · ${linha.marca}` : ""}
                      {!linha.temProduto && (
                        <span className="text-amber"> · fora do catálogo do Bling</span>
                      )}
                    </span>
                  </td>
                  <td className="num px-3 py-2 text-right">
                    {linha.custo > 0 ? moeda.format(linha.custo) : <span className="text-muted">—</span>}
                  </td>
                  <td className="num text-muted px-3 py-2 text-right">
                    {linha.peso > 0 ? linha.peso.toLocaleString("pt-BR") : "—"}
                  </td>

                  {linha.anuncios.length === 0 ? (
                    <td
                      colSpan={modalidades.length * 7 + 1}
                      className="border-sage border-l px-3 py-2 text-center"
                    >
                      <button
                        onClick={() => void anunciar(linha.sku)}
                        className="bg-signal rounded-[6px] px-3 py-1.5 text-xs font-medium text-white hover:brightness-110"
                      >
                        Anunciar nesta conta
                      </button>
                    </td>
                  ) : (
                    <>
                      {modalidades.map((m) => {
                        const anuncio = linha.anuncios.find((a) => a.modalidade === m);
                        if (!anuncio) {
                          return (
                            <td
                              key={m}
                              colSpan={7}
                              className="border-sage text-muted border-l px-3 py-2 text-center text-xs"
                            >
                              sem anúncio
                            </td>
                          );
                        }
                        return (
                          <Celulas
                            key={m}
                            anuncio={anuncio}
                            resultado={calcularAnuncio(linha, anuncio)}
                            temCusto={linha.custo > 0}
                            onComissao={(v) => void aplicar(anuncio.anuncioId, { comissao: v })}
                            onPromocao={(v) => void aplicar(anuncio.anuncioId, { promocao: v })}
                            onPreco={(v) => void aplicar(anuncio.anuncioId, { preco: v })}
                            onMargem={(v) => aplicarMargem(linha, anuncio, v)}
                          />
                        );
                      })}
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => void remover(linha.sku, linha.nome)}
                          className="text-muted hover:text-alert text-xs underline underline-offset-4"
                        >
                          remover
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        {ultimaPagina > 1 && (
          <div className="mt-5 flex items-center justify-between gap-4">
            <p className="text-muted num text-sm">
              Página {inteiro.format(pagina)} de {inteiro.format(ultimaPagina)}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
                disabled={pagina <= 1}
                className="border-sage rounded-[6px] border px-4 py-2 text-sm hover:bg-sage/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                onClick={() => setPagina((p) => Math.min(ultimaPagina, p + 1))}
                disabled={pagina >= ultimaPagina}
                className="border-sage rounded-[6px] border px-4 py-2 text-sm hover:bg-sage/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Próxima
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}


/**
 * As seis colunas de uma modalidade.
 *
 * Preço e Margem são os dois lados da mesma conta: digitar um recalcula o
 * outro. A margem só aceita edição quando existe custo — sem custo não há de
 * onde tirar o preço. O preço, esse, é sempre editável: cadastrar um valor não
 * depende de o catálogo já ter sido lido.
 */
function Celulas({
  anuncio,
  resultado,
  temCusto,
  onComissao,
  onPromocao,
  onPreco,
  onMargem,
}: {
  anuncio: AnuncioLinha;
  resultado: Resultado | null;
  temCusto: boolean;
  onComissao: (valor: number) => void;
  onPromocao: (valor: number) => void;
  onPreco: (valor: number) => void;
  onMargem: (valor: number) => void;
}) {
  const semPreco = anuncio.preco <= 0;
  const mostra = resultado && !semPreco;
  const prejuizo = Boolean(mostra && temCusto && resultado!.lucro < 0);

  const campo =
    "num border-sage rounded-[6px] border px-1.5 py-1 text-right focus:border-signal disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <>
      <td className="border-sage border-l px-2 py-2 text-right">
        <input
          type="text"
          inputMode="decimal"
          defaultValue={Number((anuncio.comissao * 100).toFixed(3)).toString()}
          key={`c-${anuncio.anuncioId}-${anuncio.comissao}`}
          onBlur={(e) => {
            const n = paraNumero(e.target.value);
            if (n !== null && n >= 0 && n <= 100 && n / 100 !== anuncio.comissao) onComissao(n / 100);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className={`${campo} w-16`}
        />
      </td>
      <td className="px-2 py-2 text-right">
        <input
          type="text"
          inputMode="decimal"
          title="Desconto promocional deste anúncio"
          defaultValue={Number((anuncio.promocao * 100).toFixed(3)).toString()}
          key={`promo-${anuncio.anuncioId}-${anuncio.promocao}`}
          onBlur={(e) => {
            const n = paraNumero(e.target.value);
            if (n !== null && n >= 0 && n <= 100 && n / 100 !== anuncio.promocao) onPromocao(n / 100);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className={`${campo} w-16 ${anuncio.promocao > 0 ? "border-amber text-amber font-medium" : ""}`}
        />
      </td>
      <td className="px-2 py-2 text-right">
        <input
          type="text"
          inputMode="decimal"
          placeholder="—"
          defaultValue={anuncio.preco > 0 ? anuncio.preco.toString() : ""}
          key={`p-${anuncio.anuncioId}-${anuncio.preco}`}
          onBlur={(e) => {
            const n = paraNumero(e.target.value);
            if (n !== null && n >= 0 && n !== anuncio.preco) onPreco(n);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className={`${campo} w-24`}
        />
      </td>
      <td className="num text-muted px-2 py-2 text-right">
        {mostra ? moeda.format(resultado!.frete) : "—"}
      </td>
      <td className="num text-muted px-2 py-2 text-right">
        {mostra ? moeda.format(resultado!.comissao) : "—"}
      </td>
      <td className={`num px-2 py-2 text-right ${prejuizo ? "text-alert font-medium" : ""}`}>
        {mostra && temCusto ? moeda.format(resultado!.lucro) : "—"}
      </td>
      <td className="px-2 py-2 text-right">
        <input
          type="text"
          inputMode="decimal"
          placeholder="—"
          disabled={!temCusto}
          title={
            temCusto
              ? "Digite a margem que você quer e o preço se ajusta"
              : "Sem custo do produto não há como calcular a margem"
          }
          defaultValue={
            mostra && temCusto && resultado!.margem !== null
              ? Number((resultado!.margem * 100).toFixed(1)).toString()
              : ""
          }
          key={`m-${anuncio.anuncioId}-${anuncio.preco}-${anuncio.comissao}-${anuncio.promocao}`}
          onBlur={(e) => {
            const n = paraNumero(e.target.value);
            if (n === null) return;
            const atual =
              mostra && resultado!.margem !== null ? resultado!.margem * 100 : null;
            if (atual !== null && Math.abs(n - atual) < 0.05) return;
            onMargem(n / 100);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className={`${campo} w-20 ${prejuizo ? "text-alert font-medium" : ""}`}
        />
      </td>
    </>
  );
}
