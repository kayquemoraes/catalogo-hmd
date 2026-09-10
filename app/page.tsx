import Link from "next/link";
import { redirect } from "next/navigation";
import { temSessao } from "@/lib/auth";
import Navegacao from "@/components/Navegacao";
import { sql, ensureSchema } from "@/lib/db";

export const dynamic = "force-dynamic";

const inteiro = new Intl.NumberFormat("pt-BR");

type Resumo = {
  produtos: number;
  lidoEm: string | null;
  canais: number;
  anunciosComPreco: number;
};

/**
 * Números só para dar contexto na entrada. Se o banco não responder, a página
 * continua abrindo com os atalhos — ela não existe para exibir estatística.
 */
async function carregarResumo(): Promise<Resumo | null> {
  try {
    await ensureSchema();
    const [produtos] = await sql<{ total: number; lido_em: string | null }[]>`
      SELECT count(*)::int AS total, max(visto_em)::text AS lido_em FROM produtos
    `;

    let canais = 0;
    let anunciosComPreco = 0;
    // As tabelas de precificação podem ainda não existir num banco recém-criado.
    const [existe] = await sql<{ presente: boolean }[]>`
      SELECT to_regclass('public.prec_anuncios') IS NOT NULL AS presente
    `;
    if (existe?.presente) {
      const [c] = await sql<{ total: number }[]>`
        SELECT count(*)::int AS total FROM prec_canais
      `;
      const [a] = await sql<{ total: number }[]>`
        SELECT count(*)::int AS total FROM prec_anuncios WHERE preco > 0
      `;
      canais = c.total;
      anunciosComPreco = a.total;
    }

    return {
      produtos: produtos.total,
      lidoEm: produtos.lido_em,
      canais,
      anunciosComPreco,
    };
  } catch {
    return null;
  }
}

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

export default async function Pagina() {
  if (!(await temSessao())) redirect("/entrar");
  const resumo = await carregarResumo();

  return (
    <>
      <Navegacao ativo="inicio" />

      <main className="mx-auto max-w-[1600px] px-6 py-12 sm:px-8">
        <header className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Painel interno HMD
          </h1>
          <p className="text-muted mt-3 text-base">
            Duas ferramentas: a leitura do catálogo de produtos do Bling e o cálculo de
            preços para os anúncios do Mercado Livre e da Shopee.
          </p>
        </header>

        {resumo && (
          <section className="border-sage mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-[6px] border bg-sage lg:grid-cols-4">
            <Indicador
              rotulo="Produtos no catálogo"
              valor={inteiro.format(resumo.produtos)}
              nota={`lido ${desde(resumo.lidoEm)}`}
            />
            <Indicador
              rotulo="Contas de anúncio"
              valor={inteiro.format(resumo.canais)}
              nota="Mercado Livre e Shopee"
            />
            <Indicador
              rotulo="Anúncios com preço"
              valor={inteiro.format(resumo.anunciosComPreco)}
              nota="somando todas as contas"
            />
            <Indicador
              rotulo="Situação"
              valor={resumo.produtos > 0 ? "Pronto" : "Sem catálogo"}
              nota={
                resumo.produtos > 0
                  ? "custos e pesos disponíveis"
                  : "leia o catálogo para calcular"
              }
              alerta={resumo.produtos === 0}
            />
          </section>
        )}

        <section className="mt-10 grid gap-5 lg:grid-cols-2">
          <Cartao
            href="/catalogo"
            titulo="Catálogo"
            descricao="Lê os produtos do Bling, guarda no banco e escreve na aba dataBase da planilha do Google."
            acao="Abrir catálogo"
            itens={[
              "Leitura completa em segundo plano",
              "Reescrita da planilha sem consultar o Bling de novo",
              "Busca por nome ou código",
            ]}
          />
          <Cartao
            href="/precificacao"
            titulo="Precificação"
            descricao="Calcula frete, comissão, lucro e margem por anúncio, a partir do custo e do peso vindos do catálogo."
            acao="Abrir precificação"
            itens={[
              "Clássico e Premium lado a lado no Mercado Livre",
              "Digite o preço e veja a margem, ou o contrário",
              "Uma conta de anúncio por vez, com filtros",
            ]}
          />
        </section>

        {resumo?.produtos === 0 && (
          <p className="bg-amber-soft text-amber mt-8 rounded-[6px] px-4 py-3 text-sm">
            O catálogo do Bling ainda não foi lido neste ambiente. A precificação funciona,
            mas sem custo e peso não há como calcular lucro nem margem — abra o Catálogo e
            clique em <strong>Ler catálogo agora</strong>.
          </p>
        )}
      </main>
    </>
  );
}

function Indicador({
  rotulo,
  valor,
  nota,
  alerta,
}: {
  rotulo: string;
  valor: string;
  nota: string;
  alerta?: boolean;
}) {
  return (
    <div className="bg-paper-raised px-5 py-4">
      <p className="text-muted text-xs tracking-wide uppercase">{rotulo}</p>
      <p className={`num mt-1.5 text-2xl font-semibold ${alerta ? "text-amber" : ""}`}>
        {valor}
      </p>
      <p className="text-muted mt-0.5 text-xs">{nota}</p>
    </div>
  );
}

function Cartao({
  href,
  titulo,
  descricao,
  acao,
  itens,
}: {
  href: string;
  titulo: string;
  descricao: string;
  acao: string;
  itens: string[];
}) {
  return (
    <Link
      href={href}
      className="border-sage bg-paper-raised hover:border-signal group flex flex-col rounded-[6px] border p-6 transition-colors"
    >
      <h2 className="text-xl font-semibold tracking-tight">{titulo}</h2>
      <p className="text-muted mt-2 text-sm">{descricao}</p>

      <ul className="text-muted mt-4 space-y-1.5 text-sm">
        {itens.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="text-signal" aria-hidden>
              •
            </span>
            {item}
          </li>
        ))}
      </ul>

      <span className="text-signal mt-6 text-sm font-medium group-hover:underline">
        {acao} →
      </span>
    </Link>
  );
}
