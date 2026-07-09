/**
 * explainCommand.js
 * Decompõe um comando (binário + flags) em explicações legíveis, estilo
 * explainshell. Base curada dos binários e flags mais comuns num diagnóstico
 * de Linux; flags desconhecidas recebem uma descrição genérica.
 */

const BINS = {
  ls: { desc: 'Lista arquivos e diretórios.', flags: { l: 'formato longo (permissões, dono, tamanho)', a: 'inclui ocultos (.*)', h: 'tamanhos legíveis (K/M/G)', t: 'ordena por data', r: 'ordem reversa', S: 'ordena por tamanho', R: 'recursivo' } },
  rm: { desc: 'Remove arquivos/diretórios.', flags: { r: 'recursivo (diretórios)', f: 'força, sem perguntar', i: 'pergunta antes de cada remoção', v: 'mostra o que remove' } },
  cp: { desc: 'Copia arquivos/diretórios.', flags: { r: 'recursivo', a: 'preserva tudo (arquivo, links, atributos)', p: 'preserva atributos', v: 'verboso', u: 'só copia se mais novo' } },
  tar: { desc: 'Empacota/desempacota arquivos.', flags: { c: 'cria arquivo', x: 'extrai', t: 'lista conteúdo', z: 'gzip', j: 'bzip2', f: 'nome do arquivo (segue)', v: 'verboso' } },
  grep: { desc: 'Busca padrões em texto.', flags: { i: 'ignora maiúsc/minúsc', r: 'recursivo', n: 'mostra nº da linha', v: 'inverte (linhas que NÃO casam)', E: 'regex estendida', c: 'conta ocorrências', o: 'só a parte que casou', w: 'palavra inteira' } },
  ps: { desc: 'Lista processos.', flags: { a: 'de todos os usuários (com tty)', u: 'formato detalhado por usuário', x: 'inclui sem terminal', e: 'todos os processos', f: 'formato em árvore/completo' } },
  ss: { desc: 'Mostra sockets de rede.', flags: { t: 'TCP', u: 'UDP', l: 'só os que escutam (listen)', n: 'numérico (não resolve nomes)', a: 'todos', p: 'mostra o processo dono' } },
  netstat: { desc: 'Estatísticas de rede (legado).', flags: { t: 'TCP', u: 'UDP', l: 'listening', n: 'numérico', p: 'processo', a: 'todos' } },
  systemctl: { desc: 'Controla serviços do systemd.', flags: {} },
  journalctl: { desc: 'Consulta o log do systemd (journal).', flags: { f: 'segue (tail -f)', e: 'pula para o fim', x: 'adiciona explicações', k: 'só mensagens do kernel', b: 'desde o último boot' } },
  df: { desc: 'Uso de espaço por filesystem.', flags: { h: 'legível (K/M/G)', i: 'inodes em vez de bytes', T: 'mostra o tipo de FS' } },
  du: { desc: 'Uso de espaço por diretório.', flags: { s: 'só o total (summary)', h: 'legível', a: 'inclui arquivos', c: 'total geral no fim' } },
  free: { desc: 'Uso de memória/swap.', flags: { h: 'legível', m: 'em MB', g: 'em GB' } },
  chmod: { desc: 'Muda permissões.', flags: { R: 'recursivo', v: 'verboso' } },
  chown: { desc: 'Muda dono/grupo.', flags: { R: 'recursivo', v: 'verboso' } },
  find: { desc: 'Busca arquivos por critérios.', flags: {} },
  kill: { desc: 'Envia sinal a um processo.', flags: { 9: 'SIGKILL (força)', 15: 'SIGTERM (padrão)' } },
  tail: { desc: 'Mostra o fim de um arquivo.', flags: { f: 'segue novas linhas (tempo real)', n: 'número de linhas' } },
  head: { desc: 'Mostra o início de um arquivo.', flags: { n: 'número de linhas' } },
  ip: { desc: 'Configura/mostra rede (iproute2).', flags: { br: 'saída resumida (brief)' } },
  dmesg: { desc: 'Mensagens do kernel (ring buffer).', flags: { T: 'timestamps legíveis', w: 'segue (follow)' } },
  iptables: { desc: 'Firewall netfilter.', flags: { L: 'lista regras', n: 'numérico', v: 'verboso (contadores)' } },
  curl: { desc: 'Transfere dados via URL.', flags: { s: 'silencioso', L: 'segue redirects', o: 'salva em arquivo', I: 'só cabeçalhos (HEAD)', k: 'ignora erro de certificado' } },
};

const GENERIC_FLAG = {
  v: 'modo verboso', h: 'ajuda/legível', r: 'recursivo/reverso', f: 'força/arquivo', n: 'numérico/nº de linhas',
  l: 'formato longo/listar', a: 'todos', q: 'silencioso (quiet)', d: 'diretório/debug', p: 'preserva/porta/processo',
};

function stripPrefix(cmd) {
  return String(cmd || '').trim().replace(/^(?:sudo(?:\s+-\S+)*\s+|time\s+|env\s+\S+=\S+\s+|watch(?:\s+-\S+)*\s+)+/i, '').trim();
}

/**
 * @param {string} cmd
 * @returns {{bin:string, desc:string, parts:Array<{token,desc}>}|null}
 */
export function explainCommand(cmd) {
  const line = stripPrefix(cmd);
  if (!line) return null;
  const tokens = line.split(/\s+/);
  const bin = tokens[0];
  const info = BINS[bin];
  const parts = [];
  const hadSudo = /^\s*sudo\b/.test(String(cmd || ''));
  if (hadSudo) parts.push({ token: 'sudo', desc: 'executa como superusuário (root)' });
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith('--')) {
      parts.push({ token: t, desc: 'opção longa — veja `man ' + bin + '`' });
    } else if (t.startsWith('-') && t.length > 1) {
      // agrupa flags curtas combinadas: -ltr → l, t, r
      const letters = t.slice(1).split('');
      const descs = letters.map((c) => (info && info.flags[c]) || GENERIC_FLAG[c] || `flag -${c}`);
      parts.push({ token: t, desc: descs.join(' · ') });
    } else {
      parts.push({ token: t, desc: 'argumento (alvo/valor)' });
    }
  }
  return { bin, desc: info ? info.desc : `Comando \`${bin}\` — veja \`man ${bin}\`.`, parts };
}

export const KNOWN_BINS = Object.keys(BINS);
