/**
 * errorHints.js
 * Varre a saída de um comando procurando mensagens de erro conhecidas e
 * sugere a correção. Devolve a lista de dicas únicas encontradas.
 */

const HINTS = [
  { re: /command not found|: not found/i, title: 'Comando não encontrado', hint: 'Verifique a digitação ou instale o pacote (apt/yum/dnf install …).', tone: 'danger' },
  { re: /permission denied/i, title: 'Permissão negada', hint: 'Talvez precise de `sudo`, ou ajuste dono/permissões (chown/chmod).', tone: 'warn' },
  { re: /operation not permitted/i, title: 'Operação não permitida', hint: 'Mesmo com root pode ser atributo imutável (`lsattr`/`chattr -i`) ou capability.', tone: 'warn' },
  { re: /no such file or directory/i, title: 'Arquivo/diretório inexistente', hint: 'Confira o caminho (use TAB/`ls`); pode faltar criar com `mkdir -p`.', tone: 'warn' },
  { re: /no space left on device/i, title: 'Disco cheio', hint: 'Rode `df -h` e `du -sh /*`; limpe logs/cache. Pode ser inodes (`df -i`).', tone: 'danger' },
  { re: /address already in use|bind.*in use/i, title: 'Porta já em uso', hint: 'Veja quem usa a porta: `ss -lntp` / `lsof -i :PORTA`.', tone: 'warn' },
  { re: /connection refused/i, title: 'Conexão recusada', hint: 'Serviço não está escutando ou firewall bloqueia. Cheque `systemctl status` e `ss -lntp`.', tone: 'warn' },
  { re: /connection timed out|timeout/i, title: 'Tempo esgotado', hint: 'Possível firewall/rota/host fora do ar. Teste `ping` e `traceroute`.', tone: 'warn' },
  { re: /name or service not known|temporary failure in name resolution|could not resolve/i, title: 'Falha de DNS', hint: 'Cheque `/etc/resolv.conf` e resolução com `dig`/`nslookup`.', tone: 'warn' },
  { re: /could not get lock|dpkg.*lock|unable to lock/i, title: 'Lock do gerenciador de pacotes', hint: 'Outro apt/dpkg rodando. Aguarde ou veja o PID em `lsof /var/lib/dpkg/lock`.', tone: 'warn' },
  { re: /unit .* not found|failed to (start|restart)/i, title: 'Falha no systemd', hint: 'Veja detalhes: `systemctl status UNIDADE` e `journalctl -xeu UNIDADE`.', tone: 'danger' },
  { re: /out of memory|cannot allocate memory|oom/i, title: 'Falta de memória', hint: 'Rode `free -h`; processo pode ter sido morto pelo OOM (cheque `dmesg`).', tone: 'danger' },
  { re: /read-only file system/i, title: 'Filesystem somente leitura', hint: 'Pode ter remontado RO por erro de I/O. Cheque `dmesg` e remonte com `mount -o remount,rw`.', tone: 'danger' },
  { re: /disk quota exceeded/i, title: 'Cota de disco excedida', hint: 'Veja a cota do usuário com `quota -s`.', tone: 'warn' },
  { re: /too many open files/i, title: 'Limite de file descriptors', hint: 'Aumente o ulimit (`ulimit -n`) ou LimitNOFILE no systemd.', tone: 'warn' },
  { re: /host key verification failed/i, title: 'Chave de host mudou', hint: 'Reinstalação ou MITM. Se confiável, remova a linha em `~/.ssh/known_hosts`.', tone: 'warn' },
  { re: /authentication fail|permission denied \(publickey/i, title: 'Falha de autenticação SSH', hint: 'Cheque usuário/chave; permissões de `~/.ssh` (700) e `authorized_keys` (600).', tone: 'warn' },
  { re: /segmentation fault|core dumped/i, title: 'Falha de segmentação', hint: 'Bug no programa ou dado corrompido. Veja core dump / logs do app.', tone: 'danger' },
  { re: /syntax error/i, title: 'Erro de sintaxe', hint: 'Revise o comando/script na linha indicada.', tone: 'warn' },
];

/**
 * @param {string} text  saída do comando (stdout+stderr juntos)
 * @returns {Array<{title,hint,tone}>}
 */
export function scanErrors(text) {
  const s = String(text || '');
  if (!s) return [];
  const found = [];
  const seen = new Set();
  for (const h of HINTS) {
    if (h.re.test(s) && !seen.has(h.title)) { seen.add(h.title); found.push({ title: h.title, hint: h.hint, tone: h.tone }); }
  }
  return found;
}

export const HINT_COUNT = HINTS.length;

// Padrões que apontam o "culpado" (token ofensivo) numa mensagem de erro.
const CULPRIT_RE = [
  /(?:^|\s)([^\s:'"]+): (?:command )?not found/i,
  /(?:^|\s)([^\s:'"]+): No such file or directory/i,
  /cannot (?:access|open|stat|remove|create|find) '?([^'\s]+)'?/i,
  /(?:Failed to locate executable|executable) '?([^\s'"]+)'?/i,
  /No such file or directory.*?['"]([^'"]+)['"]/i,
  /unable to resolve host ([^\s:]+)/i,
  /could not resolve host:? ([^\s]+)/i,
  /(?:unrecognized|invalid|illegal|unknown) option[^'"`\w]*['"`]?(-{0,2}[\w-]+)/i,
  /option requires an argument -+ '?([\w-]+)'?/i,
  /([^\s:'"]+): Permission denied/i,
];

/**
 * Tenta identificar QUAL parâmetro digitado pelo usuário causou o erro.
 * Casa o token extraído da mensagem com os tokens do comando; devolve o token
 * do comando (o que o usuário escreveu) quando possível.
 * @returns {{token:string, hint:string}|null}
 */
export function findCulprit(command, output) {
  const out = String(output || '');
  let bad = null;
  for (const re of CULPRIT_RE) { const m = out.match(re); if (m && m[1]) { bad = m[1]; break; } }
  if (!bad) return null;
  const cmd = String(command || '').trim();
  if (cmd) {
    const tokens = cmd.split(/\s+/);
    const base = bad.replace(/.*\//, '');
    // token idêntico, ou que contém o "bad" (caminho), ou cujo basename bate
    const hit = tokens.find((t) => t === bad || t.includes(bad) || t.replace(/.*\//, '') === base);
    if (hit) return { token: hit, hint: `o parâmetro "${hit}" do comando causou o erro` };
  }
  return { token: bad, hint: `"${bad}" causou o erro` };
}
