/**
 * O endereço público da aplicação, sempre em forma utilizável.
 *
 * `APP_URL` é digitada à mão num painel de variáveis, e é fácil colar o
 * domínio sem o `https://` ou com uma barra sobrando. Como esse valor vira o
 * `redirect_uri` enviado ao Bling, qualquer diferença — inclusive a ausência
 * do protocolo — faz o Bling recusar a autorização com `redirect_uri_mismatch`,
 * um erro que não diz onde está o problema.
 *
 * Aqui o valor é normalizado uma vez só, e todo mundo passa por este ponto.
 */

let avisou = false;

export function enderecoDaAplicacao(): string {
  const bruto = (process.env.APP_URL ?? "").trim();
  if (!bruto) throw new Error("APP_URL não configurada.");

  const semBarra = bruto.replace(/\/+$/, "");
  const temProtocolo = /^https?:\/\//i.test(semBarra);

  // Endereço local roda sem certificado; o resto do mundo é https.
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/i.test(semBarra);
  const completo = temProtocolo ? semBarra : `${local ? "http" : "https"}://${semBarra}`;

  let url: URL;
  try {
    url = new URL(completo);
  } catch {
    throw new Error(
      `APP_URL não é um endereço válido: "${bruto}". ` +
        `Use algo como https://seu-app.up.railway.app, sem barra no final.`
    );
  }

  if (!temProtocolo && !avisou) {
    avisou = true;
    console.warn(
      `[APP_URL] O valor "${bruto}" veio sem protocolo; assumindo "${url.origin}". ` +
        `Corrija a variável para evitar divergência com o link de redirecionamento do Bling.`
    );
  }

  return url.origin;
}

/** O endereço de retorno do OAuth, que precisa bater com o cadastrado no Bling. */
export function enderecoDeCallback(): string {
  return `${enderecoDaAplicacao()}/bling/callback`;
}
