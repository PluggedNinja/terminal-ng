/**
 * dangerCheck.js
 * Detecta comandos destrutivos/perigosos antes (ou no momento) da execução.
 * Retorna { level: 'critical'|'warn'|null, reason, hint } — fail-open: na
 * dúvida devolve null para nunca atrapalhar o fluxo do usuário.
 */

const RULES = [
  // ── críticos: destruição em massa ──
  { level: 'critical', re: /\brm\b[^|]*\s-[a-z]*r[a-z]*f|\brm\b[^|]*\s-[a-z]*f[a-z]*r/i, reason: 'rm -rf — remoção recursiva e forçada', hint: 'Confirme o caminho. Use `ls` antes; prefira mover para /tmp ou `rm -i`.' },
  { level: 'critical', re: /\brm\b\s+(-[a-z]*\s+)*(\/|\/\*|\/\s|~\s*$|\.\s*$|\*\s*$)/i, reason: 'rm em / , ~ ou * — pode apagar tudo', hint: 'Caminho perigoso. Reveja o alvo antes de executar.' },
  { level: 'critical', re: /\b(mkfs|mke2fs|mkfs\.\w+)\b/i, reason: 'mkfs — formata o sistema de arquivos (apaga dados)', hint: 'Confirme o dispositivo (lsblk). Formatar o disco errado destrói dados.' },
  { level: 'critical', re: /\bdd\b[^|]*\bof=\/dev\/(sd|nvme|vd|hd|mmcblk|disk)/i, reason: 'dd gravando direto em disco', hint: 'of= aponta para um disco físico. Verifique com `lsblk` — erro aqui zera a unidade.' },
  { level: 'critical', re: />\s*\/dev\/(sd|nvme|vd|hd)[a-z]/i, reason: 'redirecionamento para dispositivo de bloco', hint: 'Escrever direto no disco corrompe o filesystem.' },
  { level: 'critical', re: /\brm\b[^|]*?\s(?:-[a-z]*\s+)*\/(?:etc|var|usr|bin|sbin|lib|lib64|boot|root|opt|srv|dev|proc|sys|run|home)(?:\/\S*)?(?:\s|$)/i, reason: 'rm em diretório VITAL do sistema', hint: 'Apagar em /etc, /var, /usr, /boot, /lib… pode inutilizar o sistema. Reveja o caminho antes.' },
  { level: 'critical', re: /:\s*\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, reason: 'fork bomb', hint: 'Trava a máquina esgotando processos. Não execute.' },
  { level: 'critical', re: /\b(shutdown|poweroff|halt|reboot|init\s+0|init\s+6)\b/i, reason: 'desliga/reinicia a máquina', hint: 'Avise os usuários e confirme que é o host certo.' },
  { level: 'critical', re: /\bchown\b\s+(-[a-z]*R[a-z]*\s+)?\S+\s+\/(\s|$|etc|usr|bin|var|boot)/i, reason: 'chown recursivo em diretório de sistema', hint: 'Mudar dono de / quebra permissões do sistema todo.' },
  { level: 'critical', re: /\bchmod\b\s+(-[a-z]*R[a-z]*\s+)?(777|-R\s+777)\s+\/(\s|$|etc|usr|var|boot)/i, reason: 'chmod 777 recursivo em sistema', hint: 'Permissões abertas demais — risco grave de segurança.' },
  { level: 'critical', re: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(bash|sh|zsh)\b/i, reason: 'pipe de download direto para shell', hint: 'Executa código remoto sem revisão. Baixe e inspecione antes.' },
  { level: 'critical', re: /\bgit\b\s+(push\s+(-f|--force)|reset\s+--hard)\b/i, reason: 'git force push / reset --hard', hint: 'Pode sobrescrever histórico ou descartar trabalho não salvo.' },
  { level: 'critical', re: />\s*\/etc\/(passwd|shadow|fstab|sudoers)\b/i, reason: 'sobrescreve arquivo crítico do sistema', hint: 'Use `>>` ou um editor; truncar este arquivo pode travar o boot/login.' },

  // ── avisos: potencialmente perigosos ──
  { level: 'warn', re: /\brm\b\s+-[a-z]*r/i, reason: 'remoção recursiva (rm -r)', hint: 'Confira o diretório antes.' },
  { level: 'warn', re: /\b(kill|pkill|killall)\b\s+-9\b/i, reason: 'kill -9 (SIGKILL)', hint: 'Mata sem dar chance de salvar/limpar. Prefira -15 (TERM) primeiro.' },
  { level: 'warn', re: /\biptables\b\s+-F\b|\bnft\b\s+flush\b/i, reason: 'limpa todas as regras de firewall', hint: 'Pode abrir o host ou cortar seu próprio acesso SSH.' },
  { level: 'warn', re: /\b(systemctl|service)\b.*\b(stop|disable|mask)\b.*\b(ssh|sshd|network|networking|firewalld)\b/i, reason: 'para serviço de rede/acesso', hint: 'Parar SSH/rede pode te deixar sem acesso remoto.' },
  { level: 'warn', re: /\btruncate\b|\b>\s*\/var\/log\//i, reason: 'truncamento de log', hint: 'Confirme que não precisa do conteúdo (use `cp` antes).' },
  { level: 'warn', re: /\b(apt|apt-get|yum|dnf)\b.*\b(remove|purge|autoremove)\b/i, reason: 'remoção de pacotes', hint: 'Veja a lista de dependências que serão removidas junto.' },
  { level: 'warn', re: /\bcrontab\b\s+-r\b/i, reason: 'crontab -r remove TODA a crontab', hint: '-r apaga tudo; provavelmente você quis -e (editar).' },
  { level: 'warn', re: /\buserdel\b|\bgroupdel\b/i, reason: 'remoção de usuário/grupo', hint: 'Considere -r e o que acontece com os arquivos do usuário.' },
];

/**
 * @param {string} cmd  linha de comando completa
 * @returns {{level:'critical'|'warn', reason:string, hint:string}|null}
 */
export function checkDanger(cmd) {
  const line = String(cmd || '').trim();
  if (!line) return null;
  // ignora comentários e strings óbvias de eco
  if (/^#/.test(line)) return null;
  for (const r of RULES) {
    if (r.re.test(line)) return { level: r.level, reason: r.reason, hint: r.hint };
  }
  return null;
}

export const DANGER_RULE_COUNT = RULES.length;

// ── Guarda PREVENTIVA: subconjunto CATASTRÓFICO que dispara o modal de
//    confirmação ANTES de executar. Não inclui rm -rf comum (ex.: node_modules,
//    /tmp) — só o que pode destruir o sistema/dados de forma irreversível.
const GUARD_RE = [
  { re: /\brm\b[^|]*?\s(?:-[a-z]*\s+)*\/(?:etc|var|usr|bin|sbin|lib|lib64|boot|root|opt|srv|dev|proc|sys|run|home)(?:\/\S*)?(?:\s|$)/i, reason: 'rm em diretório VITAL do sistema', hint: 'Apagar em /etc, /var, /usr, /boot, /lib… pode inutilizar o sistema.' },
  { re: /\brm\b\s+(?:-[a-z]*\s+)*(?:\/|~|\*|\.)(?:\s|$)/i, reason: 'rm em / , ~ , * ou . (alvo perigoso)', hint: 'Pode apagar TUDO / o diretório atual. Reveja o alvo.' },
  { re: /\b(mkfs|mke2fs|mkfs\.\w+|wipefs)\b/i, reason: 'formata o filesystem (apaga dados)', hint: 'Confirme o dispositivo com lsblk.' },
  { re: /\bdd\b[^|]*\bof=\/dev\/(sd|nvme|vd|hd|mmcblk|disk)/i, reason: 'dd gravando direto no disco', hint: 'of= aponta p/ um disco físico — zera a unidade.' },
  { re: />\s*\/dev\/(sd|nvme|vd|hd)[a-z]/i, reason: 'redireciona p/ dispositivo de bloco', hint: 'Corrompe o filesystem.' },
  { re: /:\s*\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, reason: 'fork bomb', hint: 'Trava a máquina.' },
  { re: /\bchown\b\s+-[a-z]*R[a-z]*\s+\S+\s+\/(?:\s|$|etc|usr|bin|var|boot|lib)/i, reason: 'chown -R em diretório de sistema', hint: 'Quebra permissões do sistema.' },
  { re: /\bchmod\b\s+-[a-z]*R[a-z]*\s+777\s+\/(?:\s|$|etc|usr|var|boot|lib)/i, reason: 'chmod -R 777 em sistema', hint: 'Risco grave de segurança.' },
  { re: />\s*\/etc\/(passwd|shadow|fstab|sudoers)\b/i, reason: 'sobrescreve arquivo crítico do sistema', hint: 'Pode travar boot/login. Use >> ou um editor.' },
  { re: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(bash|sh|zsh)\b/i, reason: 'download direto para o shell', hint: 'Executa código remoto sem revisão.' },
];

/**
 * Retorna a razão/dica se o comando for CATASTRÓFICO (p/ o modal de confirmação),
 * ou null. Fail-open: na dúvida, não bloqueia.
 * @returns {{reason:string, hint:string}|null}
 */
export function checkGuard(cmd) {
  const s = String(cmd || '').trim();
  if (!s || s.startsWith('#')) return null;
  for (const r of GUARD_RE) { if (r.re.test(s)) return { reason: r.reason, hint: r.hint }; }
  return null;
}
