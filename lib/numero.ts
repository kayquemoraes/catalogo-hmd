/**
 * Leitura de números digitados por pessoa.
 *
 * Aceita "32,5" e "32.5". Quando aparecem os dois separadores, o último é o
 * decimal — "1.234,50" e "1,234.50" chegam ao mesmo número. Isso existe porque
 * o teclado brasileiro usa vírgula, mas um campo numérico do navegador devolve
 * ponto: tratar ponto sempre como separador de milhar transformaria 32.5 em 325.
 */
export function paraNumero(texto: string): number | null {
  const bruto = texto.trim().replace(/\s|R\$/gi, "");
  if (bruto === "") return null;

  const ultimaVirgula = bruto.lastIndexOf(",");
  const ultimoPonto = bruto.lastIndexOf(".");

  let limpo: string;
  if (ultimaVirgula >= 0 && ultimoPonto >= 0) {
    const decimal = ultimaVirgula > ultimoPonto ? "," : ".";
    const milhar = decimal === "," ? "." : ",";
    limpo = bruto.split(milhar).join("").replace(decimal, ".");
  } else if (ultimaVirgula >= 0) {
    limpo = bruto.replace(",", ".");
  } else {
    limpo = bruto;
  }

  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}
