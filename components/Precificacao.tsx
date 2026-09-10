"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  calcular,
  precoParaMargem,
  type Resultado,
  type TabelaFrete,
  type TipoCanal,
} from "@/lib/precificacao";
import { apenasNumero, emPercentual, emReais, paraNumero } from "@/lib/numero";

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

type Numeros = {
  comPreco: number;
  comMargem: number;
  prejuizo: number;
  lucroTotal: number;
  custoTotal: number;
  /** Lucro total dividido pelo custo total: quanto o capital rende. */
  margemPonderada: number | null;
  /** Média simples das margens: a do anúncio típico. */
  margemSimples: number | null;
};

type Resumo = {
  produtos: number;
  geral: Numeros;
  modalidades: Partial<Record<Modalidade, Numeros>>;
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

  const [busca, setBusca] = useState({ sku: "", nome: "", marca: "" });
  const [filtro, setFiltro] = useState({ sku: "", nome: "", marca: "" });
  const [situacao, setSituacao] = useState<Situacao>("todos");
  const [resumo, setResumo] = useState<Resumo | null>(null);

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

  /** Os filtros na forma que as duas rotas esperam. */
  const parametros = useMemo(() => {
    const p = new URLSearchParams({ situacao });
    if (filtro.sku) p.set("sku", filtro.sku);
    if (filtro.nome) p.set("nome", filtro.nome);
    if (filtro.marca) p.set("marca", filtro.marca);
    return p.toString();
  }, [filtro, situacao]);

  const buscarLinhas = useCallback(async () => {
    if (!canalId) return;
    const meu = ++pedido.current;
    setCarregandoLinhas(true);
    try {
      const r = await fetch(
        `/api/precificacao/linhas?canal=${canalId}&${parametros}&pagina=${pagina}`
      );
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
  }, [canalId, parametros, pagina]);

  useEffect(() => {
    void buscarLinhas();
  }, [buscarLinhas]);

  /**
   * O resumo é uma consulta à parte porque percorre TODOS os anúncios que
   * casam com o filtro, não só a página. Recarrega junto com a lista e a cada
   * salvamento, para os cartões não descreverem um estado que já mudou.
   */
  const buscarResumo = useCallback(async () => {
    if (!canalId) return;
    try {
      const r = await fetch(`/api/precificacao/resumo?canal=${canalId}&${parametros}`);
      const dados = await r.json();
      if (r.ok) setResumo(dados);
    } catch {
      /* os cartões são acessórios: falhar aqui não derruba a tela */
    }
  }, [canalId, parametros]);

  useEffect(() => {
    void buscarResumo();
  }, [buscarResumo]);

  const canal = useMemo(
    () => contexto?.canais.find((c) => c.id === canalId) ?? null,
    [contexto, canalId]
  );

  const modalidades: Modalidade[] = canal?.tipo === "ml" ? ["classico", "premium"] : ["unico"];
  const semCatalogo = (contexto?.produtosNoCatalogo ?? 0) === 0;

  // O Mercado Livre mostra duas modalidades lado a lado (18 colunas) e a
  // Shopee só uma (11), então cada caso tem seu reparto. Preço e Margem
  // recebem as fatias maiores: são o que se lê e o que se digita.
  const larguras =
    modalidades.length === 2
      ? {
          produto: "13%",
          custo: "5.5%",
          peso: "4.5%",
          acoes: "4%",
          modalidade: ["4.5%", "4.5%", "7%", "4.5%", "5%", "5%", "6%"],
        }
      : {
          produto: "24%",
          custo: "8%",
          peso: "6%",
          acoes: "6%",
          modalidade: ["7%", "7%", "11%", "6%", "8%", "8%", "9%"],
        };

  /**
   * Clássico e Premium se distinguem pela etiqueta e pela divisa grossa entre
   * os blocos — não por fundo. Colorir só uma das modalidades marcaria uma
   * delas em vez de separar as duas, e cortaria a listra que atravessa a
   * linha, que é o que permite ler o nome à esquerda e acompanhar até a
   * direita sem perder a altura.
   */
  const etiquetaDaModalidade = (indice: number) =>
    indice === 1 ? "bg-ink text-paper" : "bg-signal/15 text-signal";

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
        void buscarResumo();
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e));
        void buscarLinhas();
      } finally {
        setSalvando((n) => n - 1);
      }
    },
    [buscarLinhas, buscarResumo]
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

  const ultimaPagina = Math.max(1, Math.ceil(total / porPagina));

  // --- tela ----------------------------------------------------------------

  return (
    <main className="min-h-screen">
      <header className="bg-ink text-paper">
        <div className="mx-auto max-w-[1800px] px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight">Precificação</h1>

              {carregandoContexto ? (
                <p className="text-sage-deep mt-1.5 text-sm">Carregando…</p>
              ) : canal ? (
                // Antes era uma frase corrida com quatro valores separados por
                // pontos; virava um borrão. Cada dado agora tem rótulo próprio.
                <dl className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1">
                  <div className="flex items-baseline gap-2">
                    <dt className="sr-only">Conta</dt>
                    <dd className="text-paper text-base font-medium">{canal.nome}</dd>
                    <span className="border-ink-line text-sage-deep rounded-full border px-2 py-0.5 text-[11px]">
                      {canal.tipo === "ml" ? "Mercado Livre" : "Shopee"}
                    </span>
                  </div>
                  <DadoDaConta rotulo="Imposto" valor={pct(canal.imposto)} />
                  <DadoDaConta rotulo="Antecipação" valor={pct(canal.antecipacao)} />
                  <DadoDaConta rotulo="Embalagem" valor={moeda.format(canal.embalagem)} />
                </dl>
              ) : (
                <p className="text-sage-deep mt-1.5 text-sm">Nenhuma conta cadastrada</p>
              )}
            </div>

            {/* Clássico e Premium têm comissões diferentes; somados, escondem
                justamente a comparação que interessa. O geral fecha a conta. */}
            <div className="flex flex-wrap gap-2">
              {modalidades.length > 1 &&
                modalidades.map((m) => (
                  <CartaoResumo
                    key={m}
                    rotulo={ROTULO[m]}
                    numeros={resumo?.modalidades[m] ?? null}
                    carregando={!resumo}
                  />
                ))}
              <CartaoResumo
                rotulo={modalidades.length > 1 ? "Geral" : "Resumo"}
                numeros={resumo?.geral ?? null}
                carregando={!resumo}
                destacado={modalidades.length > 1}
              />
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
                  className="border-ink-line bg-ink-soft text-paper rounded-[6px] border px-3 py-2 text-sm"
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
                className="border-ink-line rounded-[6px] border px-3.5 py-2 text-sm font-medium hover:bg-ink-soft"
              >
                Editar conta
              </a>
            </div>
          </div>

        </div>
      </header>

      <div className="mx-auto max-w-[1800px] px-4 py-4 sm:px-6">
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
        <div className="border-sage bg-paper-raised mb-3 flex flex-wrap items-center gap-4 rounded-[6px] border px-4 py-3">
          <CampoDeBusca
            rotulo="SKU"
            valor={busca.sku}
            onMudar={(v) => setBusca((b) => ({ ...b, sku: v }))}
          />
          <CampoDeBusca
            rotulo="Nome"
            valor={busca.nome}
            onMudar={(v) => setBusca((b) => ({ ...b, nome: v }))}
            largo
          />
          <CampoDeBusca
            rotulo="Marca"
            valor={busca.marca}
            onMudar={(v) => setBusca((b) => ({ ...b, marca: v }))}
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
          </p>
        </div>

        {/* Tabela */}
        {/* A tabela tem a própria rolagem vertical: assim o cabeçalho gruda
            dentro dela, sem depender de medir a altura do que vem acima. */}
        <div className="border-sage bg-paper-raised max-h-[calc(100vh-16rem)] min-h-[18rem] overflow-y-auto rounded-[6px] border">
          <table className="w-full table-fixed border-collapse text-xs">
            {/* Larguras fixas em porcentagem: a tabela cabe sempre na largura
                disponível, em vez de empurrar uma barra de rolagem lateral. */}
            <colgroup>
              <col style={{ width: larguras.produto }} />
              <col style={{ width: larguras.custo }} />
              <col style={{ width: larguras.peso }} />
              {modalidades.map((m) => (
                <Fragment key={m}>
                  {larguras.modalidade.map((w, i) => (
                    <col key={i} style={{ width: w }} />
                  ))}
                </Fragment>
              ))}
              <col style={{ width: larguras.acoes }} />
            </colgroup>

            <thead>
              <tr>
                <th className="bg-sage border-sage border-r-sage-deep/60 sticky top-0 z-20 border-r border-b px-3 py-2.5 text-left font-semibold">
                  Produto
                </th>
                <th className="bg-sage border-sage sticky top-0 z-20 border-b px-1 py-2.5 font-semibold">
                  Custo
                </th>
                <th className="bg-sage border-sage sticky top-0 z-20 border-b px-1 py-2.5 font-semibold">
                  Peso
                </th>
                {modalidades.map((m, i) => (
                  <th
                    key={m}
                    colSpan={7}
                    className="bg-sage border-sage border-l-sage-deep sticky top-0 z-20 border-b border-l-2 px-2 py-2"
                  >
                    <span
                      className={`${etiquetaDaModalidade(i)} inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wider uppercase`}
                    >
                      {ROTULO[m]}
                    </span>
                  </th>
                ))}
                <th className="bg-sage border-sage sticky top-0 z-20 border-b" />
              </tr>

              <tr>
                <th className="bg-paper-raised border-sage text-muted border-r-sage-deep/60 sticky top-[36px] z-20 border-r border-b px-3 py-1.5 text-left font-normal">
                  SKU · marca
                </th>
                <th className="bg-paper-raised border-sage text-muted sticky top-[36px] z-20 border-b px-1 py-1.5 font-normal">
                  R$
                </th>
                <th className="bg-paper-raised border-sage text-muted sticky top-[36px] z-20 border-b px-1 py-1.5 font-normal">
                  kg
                </th>
                {modalidades.map((m, i) => {
                  const secundaria = `bg-paper-raised border-sage text-muted sticky top-[36px] z-20 border-b px-1 py-1.5 font-normal`;
                  const chave =
                    "bg-signal-soft border-sage text-signal sticky top-[36px] z-20 border-b px-1 py-1.5 font-semibold";
                  return (
                    <Fragment key={m}>
                      <th className={`${secundaria} border-l-sage-deep border-l-2`}>% taxa</th>
                      <th className={secundaria}>% promo</th>
                      <th className={chave}>Preço</th>
                      <th className={secundaria}>Frete</th>
                      <th className={secundaria}>Comissão</th>
                      <th className={secundaria}>Lucro</th>
                      <th className={chave}>Margem</th>
                    </Fragment>
                  );
                })}
                <th className="bg-paper-raised border-sage sticky top-[36px] z-20 border-b" />
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
                <tr key={linha.sku} className="border-sage/40 even:bg-sage/25 hover:bg-signal-soft! border-b text-center">
                  <td className="border-r-sage-deep/60 border-r px-3 py-1.5 text-left">
                    <span className="block truncate font-medium" title={linha.nome}>
                      {linha.nome}
                    </span>
                    <span className="text-muted block truncate text-[11px]">
                      {linha.sku}
                      {linha.marca ? ` · ${linha.marca}` : ""}
                      {!linha.temProduto && <span className="text-amber"> · fora do catálogo</span>}
                    </span>
                  </td>
                  <td className="num px-1 py-1.5">
                    {linha.custo > 0 ? moeda.format(linha.custo) : <span className="text-muted">—</span>}
                  </td>
                  <td className="num text-muted px-1 py-1.5">
                    {linha.peso > 0 ? linha.peso.toLocaleString("pt-BR") : "—"}
                  </td>

                  {linha.anuncios.length === 0 ? (
                    <td colSpan={modalidades.length * 7 + 1} className="border-sage border-l px-2 py-1.5">
                      <button
                        onClick={() => void anunciar(linha.sku)}
                        className="bg-signal rounded-[6px] px-3 py-1 text-xs font-medium text-white hover:brightness-110"
                      >
                        Anunciar nesta conta
                      </button>
                    </td>
                  ) : (
                    <>
                      {modalidades.map((m, i) => {
                        const anuncio = linha.anuncios.find((a) => a.modalidade === m);
                        if (!anuncio) {
                          return (
                            <td
                              key={m}
                              colSpan={7}
                              className="border-l-sage-deep text-muted border-l-2 px-2 py-1.5"
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
                      <td className="px-1 py-1.5">
                        <button
                          onClick={() => void remover(linha.sku, linha.nome)}
                          title={`Deixar de anunciar ${linha.nome} nesta conta`}
                          className="text-muted hover:text-alert text-[11px] underline underline-offset-2"
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
/** Um campo de busca rotulado. Os três se somam: preencher dois restringe mais. */
function CampoDeBusca({
  rotulo,
  valor,
  onMudar,
  largo,
}: {
  rotulo: string;
  valor: string;
  onMudar: (valor: string) => void;
  largo?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 text-sm ${largo ? "min-w-48 flex-1" : ""}`}>
      <span className="text-muted text-xs tracking-wide uppercase">{rotulo}</span>
      <input
        value={valor}
        onChange={(e) => onMudar(e.target.value)}
        className={`border-sage focus:border-signal rounded-[6px] border px-2.5 py-1.5 text-sm ${
          largo ? "w-full" : "w-32"
        }`}
      />
    </label>
  );
}

/** Um par rótulo/valor da conta, no cabeçalho escuro. */
function DadoDaConta({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-sage-deep text-[11px] tracking-wide uppercase">{rotulo}</dt>
      <dd className="num text-paper text-sm font-medium">{valor}</dd>
    </div>
  );
}

/**
 * Cartão de resumo de um recorte — uma modalidade ou o total.
 *
 * A margem fica em destaque; embaixo, quantos anúncios entraram na conta e
 * quantos estão no prejuízo. O prejuízo acende em vermelho a partir de um:
 * vender abaixo do custo merece ser visto de longe.
 */
function CartaoResumo({
  rotulo,
  numeros,
  carregando,
  destacado,
}: {
  rotulo: string;
  numeros: Numeros | null;
  carregando: boolean;
  destacado?: boolean;
}) {
  const semMargem = !numeros || numeros.margemPonderada === null;
  const prejuizo = numeros?.prejuizo ?? 0;

  return (
    // O cartão é sempre neutro. Pintá-lo inteiro de vermelho transformava um
    // dado em alarme e ainda por cima competia com a margem, que é a
    // informação principal — o aviso vai numa etiqueta, do tamanho do recado.
    <div
      className={`min-w-[9.5rem] rounded-[6px] border px-3 py-2 ${
        destacado ? "border-sage-deep/40 bg-ink-soft" : "border-ink-line bg-ink-soft/60"
      }`}
    >
      <p className="text-sage-deep text-[10px] font-medium tracking-wider uppercase">{rotulo}</p>

      <p className="num text-paper mt-0.5 text-xl leading-none font-semibold">
        {carregando ? "…" : semMargem ? "—" : pct(numeros!.margemPonderada!)}
      </p>

      {carregando || semMargem ? (
        <p className="text-sage-deep mt-1.5 text-[11px] leading-tight">
          {carregando
            ? "carregando…"
            : numeros && numeros.comPreco > 0
              ? "sem custo dos produtos"
              : "sem anúncio com preço"}
        </p>
      ) : (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-sage-deep num text-[11px]">
            {inteiro.format(numeros!.comMargem)} anúncios
          </span>
          {prejuizo > 0 && (
            <span className="bg-amber/25 text-amber-soft num rounded-full px-1.5 py-0.5 text-[10px] font-semibold">
              {inteiro.format(prejuizo)} no prejuízo
            </span>
          )}
        </div>
      )}
    </div>
  );
}

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

  /** Margem em pontos percentuais, ou nula quando não há como calcular. */
  const margemAtual =
    mostra && temCusto && resultado!.margem !== null ? resultado!.margem * 100 : null;

  // Campos secundários: discretos, para não competir com o que importa.
  const campo =
    "num border-sage w-full rounded-[4px] border px-1 py-1 text-center focus:border-signal disabled:cursor-not-allowed disabled:opacity-40";

  // Preço e Margem são as duas pontas da decisão — o que se digita e o que se
  // lê. Ganham fundo próprio, texto maior e peso, para o olho achar a coluna
  // sem precisar contar cabeçalhos.
  const destaque =
    "num border-signal/40 bg-paper-raised w-full rounded-[4px] border px-1 py-1 text-center text-sm font-semibold focus:border-signal disabled:cursor-not-allowed disabled:opacity-40";
  // Translúcido de propósito: a listra da linha precisa aparecer por baixo,
  // senão a faixa se interrompe justamente nas colunas mais olhadas.
  const celulaDestaque = "bg-signal-soft/45 px-1 py-1.5";
  const celula = "px-1 py-1.5";

  return (
    <>
      <td className={`${celula} border-l-sage-deep border-l-2`}>
        <input
          type="text"
          inputMode="decimal"
          onInput={(e) => apenasNumero(e.currentTarget)}
          title="Percentual cobrado pelo marketplace"
          defaultValue={emPercentual(anuncio.comissao * 100, 3)}
          key={`c-${anuncio.anuncioId}-${anuncio.comissao}`}
          onBlur={(e) => {
            const n = paraNumero(e.target.value);
            if (n !== null && n >= 0 && n <= 100 && n / 100 !== anuncio.comissao) onComissao(n / 100);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className={campo}
        />
      </td>

      <td className={celula}>
        <input
          type="text"
          inputMode="decimal"
          onInput={(e) => apenasNumero(e.currentTarget)}
          title="Desconto promocional deste anúncio"
          defaultValue={emPercentual(anuncio.promocao * 100, 3)}
          key={`promo-${anuncio.anuncioId}-${anuncio.promocao}`}
          onBlur={(e) => {
            const n = paraNumero(e.target.value);
            if (n !== null && n >= 0 && n <= 100 && n / 100 !== anuncio.promocao) onPromocao(n / 100);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className={`${campo} ${anuncio.promocao > 0 ? "border-amber text-amber font-medium" : ""}`}
        />
      </td>

      <td className={celulaDestaque}>
        <input
          type="text"
          inputMode="decimal"
          onInput={(e) => apenasNumero(e.currentTarget)}
          placeholder="—"
          title="Preço do anúncio"
          defaultValue={anuncio.preco > 0 ? emReais(anuncio.preco) : ""}
          key={`p-${anuncio.anuncioId}-${anuncio.preco}`}
          onBlur={(e) => {
            const n = paraNumero(e.target.value);
            if (n !== null && n >= 0 && n !== anuncio.preco) onPreco(n);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className={destaque}
        />
      </td>

      <td className={`num text-muted ${celula}`}>
        {mostra ? moeda.format(resultado!.frete) : "—"}
      </td>
      <td className={`num text-muted ${celula}`}>
        {mostra ? moeda.format(resultado!.comissao) : "—"}
      </td>
      <td className={`num ${celula} ${prejuizo ? "text-alert font-medium" : ""}`}>
        {mostra && temCusto ? moeda.format(resultado!.lucro) : "—"}
      </td>

      <td className={celulaDestaque}>
        <input
          type="text"
          inputMode="decimal"
          onInput={(e) => apenasNumero(e.currentTarget)}
          placeholder="—"
          disabled={!temCusto}
          title={
            temCusto
              ? "Digite a margem que você quer e o preço se ajusta"
              : "Sem custo do produto não há como calcular a margem"
          }
          // Parado mostra "72,9%", para ninguém ler o número como reais; ao
          // receber o foco, o símbolo sai e sobra só o que se digita.
          defaultValue={margemAtual === null ? "" : `${emPercentual(margemAtual, 1)}%`}
          key={`m-${anuncio.anuncioId}-${anuncio.preco}-${anuncio.comissao}-${anuncio.promocao}`}
          onFocus={(e) => {
            e.currentTarget.value = e.currentTarget.value.replace("%", "").trim();
            e.currentTarget.select();
          }}
          onBlur={(e) => {
            const n = paraNumero(e.currentTarget.value);
            const mudou = n !== null && (margemAtual === null || Math.abs(n - margemAtual) >= 0.05);
            if (mudou) {
              onMargem(n / 100);
              return;
            }
            // Sem mudança o campo não é remontado, então o símbolo volta aqui.
            e.currentTarget.value = margemAtual === null ? "" : `${emPercentual(margemAtual, 1)}%`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.currentTarget.value =
                margemAtual === null ? "" : `${emPercentual(margemAtual, 1)}%`;
              e.currentTarget.blur();
            }
          }}
          className={`${destaque} ${prejuizo ? "border-alert/50 text-alert" : ""}`}
        />
      </td>
    </>
  );
}
