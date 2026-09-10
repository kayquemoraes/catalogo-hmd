"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Leitura = {
  rodando: boolean;
  processados: number;
  pagina: number;
  iniciadaEm: string | null;
  encerradaEm: string | null;
  resultado: string | null;
  erro: string | null;
};

type Status = {
  conectado: boolean;
  leitura: Leitura;
  total: number;
  atualizadoEm: string | null;
  planilha: {
    configurada: boolean;
    escritaEm: string | null;
    url: string | null;
  };
};

type Produto = {
  id: number;
  codigo: string;
  nome: string;
  precoCusto: number;
  pesoLiquido: number;
  saldo: number;
};

const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const decimal = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});
const inteiro = new Intl.NumberFormat("pt-BR");

function desde(iso: string | null): string {
  if (!iso) return "nunca";
  const minutos = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutos < 1) return "agora há pouco";
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "ontem" : `há ${dias} dias`;
}

export default function Painel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [busca, setBusca] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [confirmacao, setConfirmacao] = useState<string | null>(null);

  const rodavaAntes = useRef(false);

  const lerStatus = useCallback(async () => {
    const r = await fetch("/api/status");
    if (!r.ok) return null;
    return (await r.json()) as Status;
  }, []);

  const lerProdutos = useCallback(async (q: string, p: number) => {
    const r = await fetch(
      `/api/products?q=${encodeURIComponent(q)}&pagina=${p}`
    );
    if (!r.ok) return;
    const dados = await r.json();
    setProdutos(dados.produtos);
    setTotal(dados.total);
  }, []);

  // Acompanha a leitura: consulta rápida enquanto roda, lenta quando parada
  useEffect(() => {
    let vivo = true;
    let timer: ReturnType<typeof setTimeout>;

    const ciclo = async () => {
      const s = await lerStatus();
      if (!vivo) return;

      if (s) {
        setStatus(s);
        // Quando a leitura termina, recarrega a tabela sozinha
        if (rodavaAntes.current && !s.leitura.rodando) {
          void lerProdutos(busca, pagina);
        }
        rodavaAntes.current = s.leitura.rodando;
      }
      setCarregando(false);

      timer = setTimeout(ciclo, s?.leitura.rodando ? 2000 : 20000);
    };

    void ciclo();
    return () => {
      vivo = false;
      clearTimeout(timer);
    };
  }, [lerStatus, lerProdutos, busca, pagina]);

  useEffect(() => {
    const atraso = setTimeout(() => void lerProdutos(busca, pagina), 250);
    return () => clearTimeout(atraso);
  }, [busca, pagina, lerProdutos]);

  const lerCatalogo = async () => {
    setAviso(null);
    const r = await fetch("/api/sync", { method: "POST" });
    const dados = await r.json();
    if (!r.ok) {
      setAviso(dados.erro ?? "Não foi possível iniciar a leitura.");
      return;
    }
    rodavaAntes.current = true;
    setConfirmacao(null);
    setStatus(await lerStatus());
  };

  const leitura = status?.leitura;
  const rodando = Boolean(leitura?.rodando);
  const paginas = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="min-h-screen">
      {/* Faixa de leitura — responde à única pergunta que este painel existe
          para responder: o catálogo está atualizado? */}
      <header className="bg-ink text-paper">
        <div className="mx-auto max-w-6xl px-6 pt-8 pb-0">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="text-sage-deep text-sm">Catálogo HMD</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                {carregando
                  ? "Consultando…"
                  : rodando
                    ? "Lendo o catálogo do Bling"
                    : status?.total
                      ? `${inteiro.format(status.total)} produtos`
                      : "Catálogo ainda não lido"}
              </h1>
              <p className="text-sage-deep mt-2 text-sm">
                {rodando
                  ? `${inteiro.format(leitura!.processados)} lidos até agora, página ${leitura!.pagina}`
                  : status?.conectado
                    ? `Lido do Bling ${desde(status.atualizadoEm)}`
                    : "Conecte a conta do Bling para começar"}
              </p>

              {status?.planilha.configurada && !rodando && (
                <p className="text-sage-deep mt-1 text-sm">
                  Planilha escrita {desde(status.planilha.escritaEm)}
                  {status.planilha.url && (
                    <>
                      {" · "}
                      <a
                        href={status.planilha.url}
                        target="_blank"
                        rel="noopener"
                        className="text-paper underline underline-offset-4"
                      >
                        Abrir planilha
                      </a>
                    </>
                  )}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 pb-1">
              {!status?.conectado && !carregando && (
                <a
                  href="/bling/authorize"
                  className="bg-signal rounded-[6px] px-4 py-2.5 text-sm font-medium text-white hover:brightness-110"
                >
                  Conectar conta do Bling
                </a>
              )}

              {status?.conectado && (
                <button
                  onClick={lerCatalogo}
                  disabled={rodando}
                  className="bg-signal rounded-[6px] px-4 py-2.5 text-sm font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {rodando ? "Leitura em andamento" : "Ler catálogo agora"}
                </button>
              )}
            </div>
          </div>

          <div
            className={`rail mt-8 h-1.5 ${rodando ? "rail-live" : ""}`}
            role="progressbar"
            aria-label="Progresso da leitura"
          >
            <div
              className="rail-fill"
              style={{
                width: rodando
                  ? `${Math.min(96, 6 + (leitura!.processados % 400) / 4.2)}%`
                  : status?.total
                    ? "100%"
                    : "0%",
              }}
            />
          </div>
        </div>
      </header>

      {(aviso || leitura?.erro) && (
        <div className="bg-alert-soft border-alert/25 border-b">
          <div className="text-alert mx-auto max-w-6xl px-6 py-3 text-sm">
            {aviso ?? leitura?.erro}
          </div>
        </div>
      )}

      {confirmacao && !aviso && (
        <div className="bg-signal-soft border-signal/25 border-b">
          <div className="text-signal mx-auto max-w-6xl px-6 py-3 text-sm">
            {confirmacao}
          </div>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <input
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setPagina(1);
            }}
            placeholder="Buscar por nome ou código"
            className="border-sage-deep bg-paper-raised placeholder:text-muted w-full max-w-sm rounded-[6px] border px-3.5 py-2.5 text-sm"
          />
          {total > 0 && (
            <p className="text-muted num text-sm">
              {inteiro.format(total)}{" "}
              {busca ? "resultados" : "produtos no total"}
            </p>
          )}
        </div>

        {produtos.length === 0 ? (
          <div className="border-sage bg-paper-raised rounded-[6px] border px-6 py-16 text-center">
            <p className="font-medium">
              {busca
                ? "Nenhum produto com esse nome ou código"
                : status?.conectado
                  ? "A tabela enche quando você lê o catálogo"
                  : "Conecte a conta do Bling para trazer os produtos"}
            </p>
            <p className="text-muted mx-auto mt-2 max-w-md text-sm">
              {busca
                ? "Tente um trecho menor do nome."
                : status?.conectado
                  ? "A leitura roda em segundo plano. Você pode fechar esta página e voltar depois."
                  : "Você será levado ao Bling para autorizar o acesso e volta para cá em seguida."}
            </p>
          </div>
        ) : (
          <div className="border-sage bg-paper-raised overflow-x-auto rounded-[6px] border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-sage text-muted border-b text-left">
                  <th className="px-4 py-3 font-medium">Código</th>
                  <th className="px-4 py-3 font-medium">Produto</th>
                  <th className="px-4 py-3 text-right font-medium">Custo</th>
                  <th className="px-4 py-3 text-right font-medium">Peso</th>
                  <th className="px-4 py-3 text-right font-medium">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {produtos.map((p) => (
                  <tr
                    key={p.id}
                    className="border-sage/70 hover:bg-signal-soft/40 border-b last:border-0"
                  >
                    <td className="num text-muted px-4 py-3 whitespace-nowrap">
                      {p.codigo || "—"}
                    </td>
                    <td className="max-w-md px-4 py-3">{p.nome}</td>
                    <td className="num px-4 py-3 text-right whitespace-nowrap">
                      {moeda.format(p.precoCusto)}
                    </td>
                    <td className="num text-muted px-4 py-3 text-right whitespace-nowrap">
                      {decimal.format(p.pesoLiquido)}
                    </td>
                    <td
                      className={`num px-4 py-3 text-right whitespace-nowrap ${
                        p.saldo <= 0 ? "text-alert" : ""
                      }`}
                    >
                      {inteiro.format(p.saldo)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {paginas > 1 && (
          <div className="mt-6 flex items-center justify-between">
            <button
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              disabled={pagina === 1}
              className="border-sage-deep rounded-[6px] border px-3.5 py-2 text-sm disabled:opacity-35"
            >
              Anterior
            </button>
            <span className="text-muted num text-sm">
              {pagina} de {paginas}
            </span>
            <button
              onClick={() => setPagina((p) => Math.min(paginas, p + 1))}
              disabled={pagina === paginas}
              className="border-sage-deep rounded-[6px] border px-3.5 py-2 text-sm disabled:opacity-35"
            >
              Próxima
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
