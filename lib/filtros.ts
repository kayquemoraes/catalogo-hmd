import type { Estoque, Situacao } from "./precificacaoDb";

const SITUACOES: Situacao[] = ["todos", "anunciados", "disponiveis"];
const ESTOQUES: Estoque[] = ["todos", "em_estoque", "em_falta"];

/**
 * Lê os filtros da URL num lugar só, para a listagem e o resumo enxergarem
 * exatamente o mesmo recorte. Separados, era questão de tempo até um passar a
 * aceitar um parâmetro que o outro ignora, e os cartões deixarem de descrever
 * a lista embaixo deles.
 */
export function filtrosDaUrl(searchParams: URLSearchParams) {
  const pedida = searchParams.get("situacao") as Situacao | null;
  const saldo = searchParams.get("estoque") as Estoque | null;
  return {
    sku: searchParams.get("sku") ?? "",
    nome: searchParams.get("nome") ?? "",
    marca: searchParams.get("marca") ?? "",
    situacao: pedida && SITUACOES.includes(pedida) ? pedida : ("todos" as Situacao),
    estoque: saldo && ESTOQUES.includes(saldo) ? saldo : ("todos" as Estoque),
  };
}
