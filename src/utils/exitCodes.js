/**
 * exitCodes.js
 * Traduz códigos de saída e sinais Unix para linguagem natural.
 * 128+N indica término por sinal N (ex.: 137 = 128+9 = SIGKILL/OOM).
 */

const SIGNALS = {
  1: ['SIGHUP', 'Hangup — terminal fechado ou pedido de recarregar config.'],
  2: ['SIGINT', 'Interrompido pelo usuário (Ctrl+C).'],
  3: ['SIGQUIT', 'Quit (Ctrl+\\) — gera core dump.'],
  4: ['SIGILL', 'Instrução ilegal.'],
  6: ['SIGABRT', 'Abortado (abort()) — falha interna/asserção.'],
  8: ['SIGFPE', 'Erro aritmético (divisão por zero, overflow).'],
  9: ['SIGKILL', 'Morto à força (kill -9) — frequentemente o OOM killer por falta de memória.'],
  11: ['SIGSEGV', 'Falha de segmentação — acesso inválido à memória (bug/corrupção).'],
  13: ['SIGPIPE', 'Escreveu num pipe sem leitor (ex.: `| head` fechou cedo).'],
  15: ['SIGTERM', 'Término solicitado (kill padrão, systemd stop).'],
  24: ['SIGXCPU', 'Limite de tempo de CPU excedido.'],
  25: ['SIGXFSZ', 'Limite de tamanho de arquivo excedido.'],
};

const SPECIAL = {
  0: ['Sucesso', 'Comando terminou sem erro.', 'ok'],
  1: ['Erro genérico', 'Falha geral — causa varia por programa.', 'warn'],
  2: ['Uso incorreto', 'Erro de sintaxe/uso (argumento inválido).', 'warn'],
  126: ['Não executável', 'Permissão negada ou não é um executável (cheque `chmod +x`).', 'danger'],
  127: ['Comando não encontrado', 'Binário inexistente no PATH (erro de digitação ou não instalado).', 'danger'],
  130: ['Interrompido (Ctrl+C)', 'Terminado por SIGINT.', 'dim'],
  137: ['Morto (SIGKILL)', '128+9 — quase sempre o OOM killer matou por falta de RAM, ou kill -9.', 'danger'],
  139: ['Segfault (SIGSEGV)', '128+11 — falha de segmentação (acesso inválido à memória).', 'danger'],
  143: ['Terminado (SIGTERM)', '128+15 — término normal (ex.: systemd parou o serviço).', 'dim'],
  255: ['Erro/fora de faixa', 'Código de saída inválido ou erro fatal (ex.: SSH falhou).', 'danger'],
};

/**
 * @param {number|string} code
 * @returns {{code:number, title:string, desc:string, tone:string}|null}
 */
export function explainExit(code) {
  const n = parseInt(code, 10);
  if (!Number.isFinite(n)) return null;
  if (SPECIAL[n]) { const [title, desc, tone] = SPECIAL[n]; return { code: n, title, desc, tone: tone || 'warn' }; }
  if (n > 128 && n < 192) {
    const sig = n - 128;
    const s = SIGNALS[sig];
    if (s) return { code: n, title: `${s[0]} (sinal ${sig})`, desc: `128+${sig} — ${s[1]}`, tone: 'danger' };
    return { code: n, title: `Sinal ${sig}`, desc: `Terminado por sinal ${sig} (128+${sig}).`, tone: 'danger' };
  }
  return { code: n, title: `Saída ${n}`, desc: 'Código de erro específico do programa — consulte sua documentação.', tone: n === 0 ? 'ok' : 'warn' };
}

export { SIGNALS };
