/**
 * Leitura e escrita de números para pessoas, em português.
 *
 * Os campos da tela mostram "1.000,00" e aceitam de volta o que a pessoa
 * digitar — com vírgula, com ponto, com separador de milhar ou sem nada
 * disso. Como o mesmo texto vira preço, a interpretação errada aqui não dá
 * erro nenhum: ela só grava um valor absurdo silenciosamente.
 */

/** Valor monetário: 1000 vira "1.000,00". */
export function emReais(n: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Percentual sem o símbolo: 11.5 vira "11,5". */
export function emPercentual(n: number, casas = 2): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: casas });
}

/** Grupo de milhar do português: ponto seguido de exatamente três dígitos. */
const SO_MILHARES = /^\d{1,3}(\.\d{3})+$/;

/**
 * Lê um número digitado.
 *
 * A vírgula é sempre decimal — é assim em português, sem ambiguidade. O ponto
 * é que depende:
 *
 * - com vírgula também presente, o ponto é separador de milhar;
 * - sozinho, em grupos de exatamente três dígitos ("1.000", "1.234.567"), é
 *   separador de milhar. É o caso que aparece quando alguém apaga os centavos
 *   de um "1.000,00" que a própria tela escreveu;
 * - sozinho, em qualquer outra forma ("32.5", "0.75"), é decimal — é como um
 *   teclado numérico ou um campo do navegador devolvem o valor.
 */
export function paraNumero(texto: string): number | null {
  const bruto = texto.trim().replace(/\s|R\$|%/gi, "");
  if (bruto === "") return null;

  const negativo = bruto.startsWith("-");
  const corpo = negativo ? bruto.slice(1) : bruto;

  let limpo: string;
  if (corpo.includes(",")) {
    // Vírgula manda: tudo que for ponto antes dela é milhar.
    const ultimaVirgula = corpo.lastIndexOf(",");
    const inteiro = corpo.slice(0, ultimaVirgula).split(".").join("");
    const decimal = corpo.slice(ultimaVirgula + 1);
    limpo = `${inteiro}.${decimal}`;
  } else if (SO_MILHARES.test(corpo)) {
    limpo = corpo.split(".").join("");
  } else {
    limpo = corpo;
  }

  const n = Number(limpo);
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
}

/**
 * Impede que letras entrem num campo numérico, enquanto se digita.
 *
 * Os campos são de texto — e não `type="number"` — porque precisam aceitar
 * vírgula decimal e mostrar "1.000,00", coisas que o campo numérico do
 * navegador não faz em português. Em troca, a filtragem fica por conta nossa.
 *
 * O cursor é reposicionado contando quantos caracteres sobreviveram antes
 * dele; sem isso, colar um texto sujo jogaria o cursor para o fim.
 */
const PROIBIDO = /[^\d.,-]/g;

/** A parte testável: o que sobra de um texto num campo numérico. */
export function limparNumerico(texto: string): string {
  return texto.replace(PROIBIDO, "");
}

export function apenasNumero(el: HTMLInputElement): void {
  const limpo = limparNumerico(el.value);
  if (limpo === el.value) return;

  const antes = el.value.slice(0, el.selectionStart ?? el.value.length);
  const posicao = limparNumerico(antes).length;
  el.value = limpo;
  el.setSelectionRange(posicao, posicao);
}
