"use client";

import { useCallback, useEffect, useState } from "react";
import type { TipoCanal } from "@/lib/precificacao";
import { paraNumero } from "@/lib/numero";

type Conta = {
  id: number;
  nome: string;
  tipo: TipoCanal;
  imposto: number;
  antecipacao: number;
  embalagem: number;
  promocaoPadrao: number;
  ativo: boolean;
};

type Padroes = { imposto: number; antecipacao: number; embalagem: number };

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const NOME_TIPO: Record<TipoCanal, string> = {
  ml: "Mercado Livre",
  shopee: "Shopee",
};

/** Compara só os campos editáveis, para saber se há algo por salvar. */
function mudou(a: Conta, b: Conta): boolean {
  return (
    a.imposto !== b.imposto ||
    a.antecipacao !== b.antecipacao ||
    a.embalagem !== b.embalagem ||
    a.promocaoPadrao !== b.promocaoPadrao
  );
}

export default function Contas() {
  const [contas, setContas] = useState<Conta[]>([]);
  const [original, setOriginal] = useState<Conta[]>([]);
  const [padroes, setPadroes] = useState<Padroes | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<number | null>(null);
  const [criando, setCriando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/precificacao/canais");
      const dados = await r.json();
      if (!r.ok) throw new Error(dados.erro ?? "Não foi possível carregar.");
      setContas(dados.canais);
      setOriginal(dados.canais);
      setPadroes(dados.padroes);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const alterar = (id: number, campos: Partial<Conta>) =>
    setContas((antes) => antes.map((c) => (c.id === id ? { ...c, ...campos } : c)));

  const salvar = async (conta: Conta) => {
    setSalvando(conta.id);
    setErro(null);
    try {
      const r = await fetch("/api/precificacao/canais", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: conta.id,
          imposto: conta.imposto,
          antecipacao: conta.antecipacao,
          embalagem: conta.embalagem,
          promocaoPadrao: conta.promocaoPadrao,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).erro ?? "Não foi possível salvar.");
      setOriginal((antes) => antes.map((c) => (c.id === conta.id ? conta : c)));
      setAviso(`${conta.nome} salva.`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(null);
    }
  };

  const remover = async (conta: Conta) => {
    const texto =
      `Apagar a conta "${conta.nome}"?\n\n` +
      `Todos os anúncios dela — preços, comissões e promoções — serão apagados junto. ` +
      `Isso não tem desfazer.\n\nDigite o nome da conta para confirmar:`;
    const resposta = prompt(texto);
    if (resposta !== conta.nome) {
      if (resposta !== null) setErro("Nome digitado não confere. Nada foi apagado.");
      return;
    }

    setSalvando(conta.id);
    try {
      const r = await fetch("/api/precificacao/canais", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: conta.id }),
      });
      if (!r.ok) throw new Error((await r.json()).erro ?? "Não foi possível apagar.");
      setAviso(`Conta ${conta.nome} apagada.`);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(null);
    }
  };

  return (
    <main className="min-h-screen">
      <header className="bg-ink text-paper">
        <div className="mx-auto max-w-[1100px] px-6 py-9 sm:px-8">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Contas de anúncio</h1>
          <p className="text-sage-deep mt-2 max-w-2xl text-sm">
            Cada conta guarda os próprios custos. Ajuste aqui uma vez e a precificação usa
            esses valores em todos os anúncios da conta.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-[1100px] px-6 py-8 sm:px-8">
        {erro && (
          <Faixa tom="alert" onFechar={() => setErro(null)}>
            {erro}
          </Faixa>
        )}
        {aviso && (
          <Faixa tom="signal" onFechar={() => setAviso(null)}>
            {aviso}
          </Faixa>
        )}

        <p className="text-muted mb-6 text-sm">
          <strong>Zero significa desligado.</strong> Uma conta que não antecipa recebíveis fica
          com antecipação 0%; uma que não cobra embalagem fica com R$ 0,00.
        </p>

        {carregando ? (
          <p className="text-muted text-sm">Carregando…</p>
        ) : (
          <div className="space-y-4">
            {contas.map((conta) => {
              const antes = original.find((c) => c.id === conta.id);
              const pendente = antes ? mudou(conta, antes) : false;

              return (
                <section
                  key={conta.id}
                  className="border-sage bg-paper-raised rounded-[6px] border p-5"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <h2 className="text-lg font-semibold">
                      {conta.nome}
                      <span className="text-muted ml-2 text-sm font-normal">
                        {NOME_TIPO[conta.tipo]}
                      </span>
                    </h2>
                    <button
                      onClick={() => void remover(conta)}
                      className="text-muted hover:text-alert text-xs underline underline-offset-4"
                    >
                      apagar conta
                    </button>
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Campo
                      rotulo="Imposto"
                      sufixo="%"
                      ajuda="Alíquota sobre o preço de venda"
                      valor={conta.imposto * 100}
                      onMudar={(n) => alterar(conta.id, { imposto: n / 100 })}
                    />
                    <Campo
                      rotulo="Antecipação"
                      sufixo="%"
                      ajuda="Taxa para receber antes do prazo"
                      valor={conta.antecipacao * 100}
                      onMudar={(n) => alterar(conta.id, { antecipacao: n / 100 })}
                    />
                    <Campo
                      rotulo="Embalagem"
                      prefixo="R$"
                      ajuda="Custo fixo por unidade vendida"
                      valor={conta.embalagem}
                      onMudar={(n) => alterar(conta.id, { embalagem: n })}
                    />
                    <Campo
                      rotulo="Promoção padrão"
                      sufixo="%"
                      ajuda="Sugerida a anúncios novos desta conta"
                      valor={conta.promocaoPadrao * 100}
                      onMudar={(n) => alterar(conta.id, { promocaoPadrao: n / 100 })}
                    />
                  </div>

                  <div className="mt-4 flex items-center gap-3">
                    <button
                      onClick={() => void salvar(conta)}
                      disabled={!pendente || salvando === conta.id}
                      className="bg-signal rounded-[6px] px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {salvando === conta.id ? "Salvando…" : "Salvar alterações"}
                    </button>
                    {pendente && (
                      <button
                        onClick={() => antes && alterar(conta.id, antes)}
                        className="text-muted text-sm underline underline-offset-4"
                      >
                        descartar
                      </button>
                    )}
                    {pendente && (
                      <span className="text-amber text-sm">alterações não salvas</span>
                    )}
                  </div>

                  <p className="text-muted mt-3 text-xs">
                    A promoção de cada anúncio é editável na tela de Precificação. Mudar a
                    promoção padrão aqui <strong>não altera</strong> os anúncios que já existem.
                  </p>
                </section>
              );
            })}
          </div>
        )}

        {/* Conta nova */}
        <section className="border-sage mt-8 rounded-[6px] border border-dashed p-5">
          {criando ? (
            <FormularioNovaConta
              padroes={padroes}
              onCancelar={() => setCriando(false)}
              onCriada={async (nome) => {
                setCriando(false);
                setAviso(`Conta ${nome} criada.`);
                await carregar();
              }}
              onErro={setErro}
            />
          ) : (
            <button
              onClick={() => setCriando(true)}
              className="border-sage rounded-[6px] border px-4 py-2 text-sm font-medium hover:bg-sage/40"
            >
              + Nova conta de anúncio
            </button>
          )}
        </section>

        {padroes && (
          <p className="text-muted mt-6 text-xs">
            Valores sugeridos para contas novas: imposto {(padroes.imposto * 100).toLocaleString("pt-BR")}%,
            antecipação {(padroes.antecipacao * 100).toLocaleString("pt-BR")}%, embalagem{" "}
            {moeda.format(padroes.embalagem)}.
          </p>
        )}
      </div>
    </main>
  );
}

function Faixa({
  tom,
  children,
  onFechar,
}: {
  tom: "alert" | "signal";
  children: React.ReactNode;
  onFechar: () => void;
}) {
  const cor = tom === "alert" ? "bg-alert-soft text-alert" : "bg-signal-soft text-signal";
  return (
    <div className={`${cor} mb-5 flex items-start justify-between gap-4 rounded-[6px] px-4 py-3 text-sm`}>
      <span>{children}</span>
      <button onClick={onFechar} className="shrink-0 underline underline-offset-4">
        fechar
      </button>
    </div>
  );
}

function Campo({
  rotulo,
  ajuda,
  valor,
  prefixo,
  sufixo,
  onMudar,
}: {
  rotulo: string;
  ajuda: string;
  valor: number;
  prefixo?: string;
  sufixo?: string;
  onMudar: (valor: number) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium">{rotulo}</span>
      <div className="mt-1 flex items-center gap-1.5">
        {prefixo && <span className="text-muted">{prefixo}</span>}
        <input
          type="text"
          inputMode="decimal"
          defaultValue={Number(valor.toFixed(4)).toString()}
          onBlur={(e) => {
            const n = paraNumero(e.target.value);
            if (n !== null && n >= 0) onMudar(n);
            else e.target.value = Number(valor.toFixed(4)).toString();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="num border-sage focus:border-signal w-full rounded-[6px] border px-2 py-1.5 text-right"
        />
        {sufixo && <span className="text-muted">{sufixo}</span>}
      </div>
      <span className="text-muted mt-1 block text-xs">{ajuda}</span>
    </label>
  );
}

function FormularioNovaConta({
  padroes,
  onCancelar,
  onCriada,
  onErro,
}: {
  padroes: Padroes | null;
  onCancelar: () => void;
  onCriada: (nome: string) => void | Promise<void>;
  onErro: (mensagem: string) => void;
}) {
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<TipoCanal>("ml");
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    if (!nome.trim()) {
      onErro("Dê um nome à conta.");
      return;
    }
    setEnviando(true);
    try {
      const r = await fetch("/api/precificacao/canais", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: nome.trim(),
          tipo,
          imposto: padroes?.imposto ?? 0,
          antecipacao: 0,
          embalagem: padroes?.embalagem ?? 0,
          promocaoPadrao: 0,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).erro ?? "Não foi possível criar.");
      await onCriada(nome.trim());
    } catch (e) {
      onErro(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div>
      <h2 className="text-base font-semibold">Nova conta de anúncio</h2>
      <p className="text-muted mt-1 text-sm">
        Ela nasce com os valores sugeridos; você ajusta depois no cartão dela.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="text-sm">
          <span className="block font-medium">Nome</span>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="mlHmd3"
            className="border-sage focus:border-signal mt-1 w-48 rounded-[6px] border px-3 py-2"
          />
        </label>

        <label className="text-sm">
          <span className="block font-medium">Marketplace</span>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoCanal)}
            className="border-sage mt-1 rounded-[6px] border px-3 py-2"
          >
            <option value="ml">Mercado Livre</option>
            <option value="shopee">Shopee</option>
          </select>
        </label>

        <button
          onClick={() => void enviar()}
          disabled={enviando}
          className="bg-signal rounded-[6px] px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
        >
          {enviando ? "Criando…" : "Criar conta"}
        </button>
        <button onClick={onCancelar} className="text-muted text-sm underline underline-offset-4">
          cancelar
        </button>
      </div>

      <p className="text-muted mt-3 text-xs">
        No Mercado Livre cada produto ganha duas modalidades, Clássico e Premium. Na Shopee,
        um anúncio só.
      </p>
    </div>
  );
}
