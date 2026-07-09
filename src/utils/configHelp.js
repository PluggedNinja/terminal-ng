/**
 * configHelp.js
 * "Config helper" do terminal: detecta abertura de editor sobre arquivos de
 * config conhecidos, extrai o parâmetro sob o cursor e fornece default +
 * descrição. Postfix/sshd têm dados AO VIVO (postconf -d / sshd -T); os demais
 * serviços usam uma base curada + fallback genérico para máxima cobertura.
 */
import { parseCron, nextRuns } from './cronParse';

// ─── Serviços genéricos (curados) ─────────────────────────────────────────
// style: 'equals' (chave = valor), 'space' (chave valor), 'colon' (yaml chave:),
//        'cron' (linha de agendamento), 'json'/'cols' (sem param)
const GENERIC_SERVICES = [
  { type: 'sysctl', label: 'sysctl · kernel', re: /(^|\/)sysctl\.conf$|\/sysctl\.d\//, style: 'equals', kb: {
    'net.ipv4.ip_forward': { def: '0', desc: 'Habilita roteamento IPv4 (1) — necessário p/ NAT/router.' },
    'net.ipv4.conf.all.rp_filter': { def: '1', desc: 'Reverse-path filter (anti-spoofing).' },
    'net.ipv4.tcp_syncookies': { def: '1', desc: 'Proteção contra SYN flood.' },
    'net.ipv6.conf.all.disable_ipv6': { def: '0', desc: 'Desativa IPv6 (1) em todas as interfaces.' },
    'net.core.somaxconn': { def: '128', desc: 'Backlog máximo de conexões aceitas (accept queue).' },
    'vm.swappiness': { def: '60', desc: 'Tendência de usar swap (0-100). Servidores: ~10.' },
    'vm.overcommit_memory': { def: '0', desc: 'Política de overcommit de memória (0/1/2).' },
    'fs.file-max': { def: '(sistema)', desc: 'Máximo de file handles do sistema.' },
    'kernel.pid_max': { def: '32768', desc: 'PID máximo.' },
    'kernel.panic': { def: '0', desc: 'Segundos até reboot após kernel panic (0 = não reinicia).' },
  } },
  { type: 'grub', label: 'GRUB · default', re: /(^|\/)default\/grub$/, style: 'equals', kb: {
    grub_timeout: { def: '5', desc: 'Segundos no menu antes de bootar o default.' },
    grub_default: { def: '0', desc: 'Entrada default (índice ou "saved").' },
    grub_cmdline_linux: { def: '""', desc: 'Parâmetros de kernel p/ todas as entradas.' },
    grub_cmdline_linux_default: { def: '"quiet splash"', desc: 'Parâmetros de kernel p/ entradas normais.' },
    grub_disable_recovery: { def: 'true', desc: 'Oculta entradas de recovery.' },
    grub_terminal: { def: '', desc: 'Terminal de entrada/saída (ex.: console serial).' },
  } },
  { type: 'systemd', label: 'systemd · unit', re: /\.(service|socket|timer|mount|target)$/, style: 'equals', kb: {
    description: { def: '', desc: 'Texto descritivo da unit.' },
    after: { def: '', desc: 'Ordena: inicia depois destas units.' },
    before: { def: '', desc: 'Ordena: inicia antes destas units.' },
    requires: { def: '', desc: 'Dependência forte (se falham, esta falha).' },
    wants: { def: '', desc: 'Dependência fraca (recomendada).' },
    execstart: { def: '', desc: 'Comando executado ao iniciar o serviço.' },
    execreload: { def: '', desc: 'Comando para recarregar a config.' },
    execstop: { def: '', desc: 'Comando para parar o serviço.' },
    restart: { def: 'no', desc: 'Política de restart (always, on-failure, on-abnormal…).' },
    restartsec: { def: '100ms', desc: 'Espera antes de reiniciar.' },
    user: { def: 'root', desc: 'Usuário sob o qual o serviço roda.' },
    group: { def: '', desc: 'Grupo do processo.' },
    workingdirectory: { def: '', desc: 'Diretório de trabalho do processo.' },
    environment: { def: '', desc: 'Variáveis de ambiente (KEY=VAL).' },
    environmentfile: { def: '', desc: 'Arquivo com variáveis de ambiente.' },
    type: { def: 'simple', desc: 'Tipo de início (simple, forking, oneshot, notify, idle).' },
    wantedby: { def: '', desc: 'Target que ativa no boot (ex.: multi-user.target).' },
    limitnofile: { def: '', desc: 'Limite de file descriptors (ulimit -n) do serviço.' },
  } },
  { type: 'mysql', label: 'MySQL/MariaDB · my.cnf', re: /(^|\/)my\.cnf$|\/mysql\//, style: 'equals', kb: {
    bind_address: { def: '127.0.0.1', desc: 'IP em que o MySQL escuta.', ex: 'bind-address = 0.0.0.0' },
    port: { def: '3306', desc: 'Porta TCP.', ex: 'port = 3306' },
    max_connections: { def: '151', desc: 'Conexões simultâneas máximas.', ex: 'max_connections = 500' },
    innodb_buffer_pool_size: { def: '128M', desc: 'Cache InnoDB de dados/índices (até ~70% da RAM).', ex: 'innodb_buffer_pool_size = 4G' },
    innodb_log_file_size: { def: '48M', desc: 'Tamanho do redo log InnoDB (maior = menos flush, recovery mais lento).', ex: 'innodb_log_file_size = 512M' },
    innodb_flush_log_at_trx_commit: { def: '1', desc: 'Durabilidade x performance (1=ACID, 2=mais rápido, 0=arriscado).', ex: 'innodb_flush_log_at_trx_commit = 2' },
    innodb_file_per_table: { def: 'ON', desc: 'Um arquivo .ibd por tabela (facilita recuperar espaço).', ex: 'innodb_file_per_table = 1' },
    datadir: { def: '/var/lib/mysql', desc: 'Diretório dos dados.', ex: 'datadir = /var/lib/mysql' },
    socket: { def: '', desc: 'Caminho do socket Unix.', ex: 'socket = /var/run/mysqld/mysqld.sock' },
    'character-set-server': { def: 'latin1', desc: 'Charset padrão (use utf8mb4).', ex: 'character-set-server = utf8mb4' },
    'collation-server': { def: '', desc: 'Collation padrão (par do charset).', ex: 'collation-server = utf8mb4_unicode_ci' },
    slow_query_log: { def: '0', desc: 'Registra queries lentas.', ex: 'slow_query_log = 1' },
    slow_query_log_file: { def: '', desc: 'Arquivo do slow query log.', ex: 'slow_query_log_file = /var/log/mysql/slow.log' },
    long_query_time: { def: '10', desc: 'Limite (s) para uma query ser "lenta".', ex: 'long_query_time = 2' },
    max_allowed_packet: { def: '64M', desc: 'Tamanho máximo de um pacote/linha.', ex: 'max_allowed_packet = 256M' },
    log_error: { def: '', desc: 'Arquivo de log de erros.', ex: 'log_error = /var/log/mysql/error.log' },
    server_id: { def: '', desc: 'ID único do servidor (obrigatório p/ replicação).', ex: 'server-id = 1' },
    log_bin: { def: '', desc: 'Ativa o binlog (replicação / point-in-time recovery).', ex: 'log_bin = /var/log/mysql/mysql-bin.log' },
    skip_name_resolve: { def: 'OFF', desc: 'Não resolve DNS nas conexões (mais rápido; use IPs nos grants).', ex: 'skip_name_resolve = ON' },
    table_open_cache: { def: '2000', desc: 'Tabelas abertas em cache.', ex: 'table_open_cache = 4000' },
    tmp_table_size: { def: '16M', desc: 'Tamanho máx. de tabelas temporárias em memória.', ex: 'tmp_table_size = 64M' },
    sql_mode: { def: '', desc: 'Modos SQL (rigor de validação).', ex: "sql_mode = STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION" },
  } },
  { type: 'php', label: 'PHP · php.ini', re: /(^|\/)php\.ini$/, style: 'equals', kb: {
    memory_limit: { def: '128M', desc: 'Memória máxima por script.' },
    max_execution_time: { def: '30', desc: 'Tempo máximo (s) de execução.' },
    upload_max_filesize: { def: '2M', desc: 'Tamanho máximo de upload.' },
    post_max_size: { def: '8M', desc: 'Tamanho máximo do corpo POST.' },
    display_errors: { def: 'Off', desc: 'Mostra erros na saída (Off em produção).' },
    error_reporting: { def: 'E_ALL', desc: 'Nível de erros reportados.' },
    'date.timezone': { def: '', desc: 'Timezone padrão.' },
    expose_php: { def: 'On', desc: 'Expõe versão do PHP no header (Off por segurança).' },
    max_input_vars: { def: '1000', desc: 'Máximo de variáveis de entrada por requisição.' },
  } },
  { type: 'redis', label: 'Redis · redis.conf', re: /(^|\/)redis\.conf$|\/redis\//, style: 'space', kb: {
    bind: { def: '127.0.0.1', desc: 'Interfaces em que o Redis escuta.' },
    port: { def: '6379', desc: 'Porta TCP (0 desativa TCP).' },
    requirepass: { def: '(nenhum)', desc: 'Senha de acesso — defina em produção!' },
    maxmemory: { def: '0', desc: 'Limite de memória (0 = sem limite).' },
    'maxmemory-policy': { def: 'noeviction', desc: 'O que fazer ao atingir maxmemory (allkeys-lru…).' },
    appendonly: { def: 'no', desc: 'Persistência AOF (durabilidade).' },
    save: { def: '3600 1 300 100', desc: 'Pontos de snapshot RDB (segundos mudanças).' },
    daemonize: { def: 'no', desc: 'Roda em background.' },
    supervised: { def: 'no', desc: 'Integração com systemd/upstart.' },
  } },
  { type: 'resolv', label: 'DNS · resolv.conf', re: /(^|\/)resolv\.conf$/, style: 'space', kb: {
    nameserver: { def: '', desc: 'IP de um servidor DNS (até 3, em ordem).' },
    search: { def: '', desc: 'Domínios anexados a nomes não-FQDN.' },
    domain: { def: '', desc: 'Domínio local default.' },
    options: { def: '', desc: 'Opções do resolver (timeout, attempts, rotate…).' },
  } },
  { type: 'chrony', label: 'chrony · NTP', re: /(^|\/)chrony\.conf$|\/chrony\//, style: 'space', kb: {
    server: { def: '', desc: 'Servidor NTP a sincronizar.' },
    pool: { def: '', desc: 'Pool de servidores NTP.' },
    driftfile: { def: '', desc: 'Arquivo que guarda o drift do relógio.' },
    makestep: { def: '', desc: 'Ajuste abrupto do relógio nas primeiras sincronizações.' },
    rtcsync: { def: '', desc: 'Sincroniza o relógio de hardware (RTC).' },
    allow: { def: '', desc: 'Faixas autorizadas a usar este chrony como servidor.' },
  } },
  { type: 'ntp', label: 'NTP · ntp.conf', re: /(^|\/)ntp\.conf$/, style: 'space', kb: {
    server: { def: '', desc: 'Servidor NTP.' },
    pool: { def: '', desc: 'Pool NTP.' },
    restrict: { def: '', desc: 'Regras de acesso NTP.' },
    driftfile: { def: '', desc: 'Arquivo de drift do relógio.' },
  } },
  { type: 'fail2ban', label: 'fail2ban · jail', re: /fail2ban\/.*\.(conf|local)$|(^|\/)jail\.(conf|local)$/, style: 'equals', kb: {
    enabled: { def: 'false', desc: 'Ativa esta jail.' },
    port: { def: '', desc: 'Porta(s) monitoradas.' },
    filter: { def: '', desc: 'Filtro (regex) aplicado ao log.' },
    logpath: { def: '', desc: 'Arquivo de log monitorado.' },
    maxretry: { def: '5', desc: 'Tentativas antes do ban.' },
    bantime: { def: '600', desc: 'Tempo de ban (s; -1 = permanente).' },
    findtime: { def: '600', desc: 'Janela (s) em que maxretry conta.' },
    ignoreip: { def: '127.0.0.1/8', desc: 'IPs que nunca são banidos.' },
    action: { def: '', desc: 'Ação ao banir (iptables, firewalld…).' },
  } },
  { type: 'samba', label: 'Samba · smb.conf', re: /(^|\/)smb\.conf$|\/samba\//, style: 'equals', kb: {
    workgroup: { def: 'WORKGROUP', desc: 'Grupo de trabalho/domínio.' },
    'server string': { def: '', desc: 'Descrição do servidor.' },
    security: { def: 'user', desc: 'Modo de segurança (user, ads…).' },
    'map to guest': { def: 'Never', desc: 'Como tratar logins inválidos.' },
    path: { def: '', desc: 'Diretório do compartilhamento.' },
    'read only': { def: 'yes', desc: 'Compartilhamento somente leitura.' },
    browseable: { def: 'yes', desc: 'Aparece na lista de compartilhamentos.' },
    'valid users': { def: '', desc: 'Usuários autorizados no share.' },
    'guest ok': { def: 'no', desc: 'Permite acesso sem senha (convidado).' },
  } },
  { type: 'selinux', label: 'SELinux · config', re: /selinux\/config$/, style: 'equals', kb: {
    selinux: { def: 'enforcing', desc: 'Modo do SELinux (enforcing, permissive, disabled).' },
    selinuxtype: { def: 'targeted', desc: 'Política carregada (targeted, mls).' },
  } },
  { type: 'journald', label: 'systemd · journald', re: /journald\.conf$/, style: 'equals', kb: {
    storage: { def: 'auto', desc: 'Onde guardar logs (auto, persistent, volatile, none).' },
    systemmaxuse: { def: '', desc: 'Espaço máximo em disco para o journal.' },
    maxretentionsec: { def: '', desc: 'Retenção máxima por tempo.' },
    forwardtosyslog: { def: 'no', desc: 'Encaminha logs ao syslog.' },
  } },
  { type: 'logind', label: 'systemd · logind', re: /logind\.conf$/, style: 'equals', kb: {
    handlelidswitch: { def: 'suspend', desc: 'Ação ao fechar a tampa (ignore, poweroff…).' },
    idleaction: { def: 'ignore', desc: 'Ação após inatividade.' },
    killuserprocesses: { def: 'no', desc: 'Mata processos do usuário ao deslogar.' },
  } },
  { type: 'logrotate', label: 'logrotate', re: /(^|\/)logrotate\.conf$|logrotate\.d\//, style: 'space', kb: {
    rotate: { def: '4', desc: 'Quantos arquivos antigos manter.' },
    daily: { def: '', desc: 'Rotaciona diariamente.' },
    weekly: { def: '', desc: 'Rotaciona semanalmente.' },
    monthly: { def: '', desc: 'Rotaciona mensalmente.' },
    compress: { def: '', desc: 'Comprime logs rotacionados (gzip).' },
    missingok: { def: '', desc: 'Não erra se o log não existir.' },
    notifempty: { def: '', desc: 'Não rotaciona se vazio.' },
    maxsize: { def: '', desc: 'Rotaciona ao atingir este tamanho.' },
  } },
  { type: 'crontab', label: 'cron', re: /(^|\/)crontab$|\/cron\.(d|daily|hourly|weekly|monthly)\//, style: 'cron', kb: {} },
  { type: 'fstab', label: 'fstab · mounts', re: /(^|\/)fstab$/, style: 'space', kb: {} },
  { type: 'hosts', label: '/etc/hosts', re: /(^|\/)hosts$/, style: 'space', kb: {} },
  { type: 'limits', label: 'security/limits', re: /security\/limits\.conf$|limits\.d\//, style: 'space', kb: {} },
  { type: 'docker', label: 'Docker · daemon.json', re: /docker\/daemon\.json$/, style: 'json', kb: {} },
  { type: 'postgres', label: 'PostgreSQL · postgresql.conf', re: /(^|\/)postgresql\.conf$|\/postgresql\//, style: 'equals', kb: {
    listen_addresses: { def: "'localhost'", desc: 'Interfaces em que escuta ("*" = todas). Cuidado em produção.' },
    port: { def: '5432', desc: 'Porta TCP.' },
    max_connections: { def: '100', desc: 'Conexões simultâneas máximas.' },
    shared_buffers: { def: '128MB', desc: 'Cache de páginas do Postgres (~25% da RAM).' },
    work_mem: { def: '4MB', desc: 'Memória por operação de sort/hash por query.' },
    maintenance_work_mem: { def: '64MB', desc: 'Memória p/ VACUUM, CREATE INDEX etc.' },
    effective_cache_size: { def: '4GB', desc: 'Estimativa de cache do SO (planejador).' },
    wal_level: { def: 'replica', desc: 'Nível do WAL (minimal, replica, logical).' },
    max_wal_size: { def: '1GB', desc: 'Tamanho-alvo do WAL antes de checkpoint.' },
    fsync: { def: 'on', desc: 'Garante durabilidade no disco. Desligar arrisca corrupção.' },
    synchronous_commit: { def: 'on', desc: 'Confirma commit só após gravar no WAL.' },
    log_min_duration_statement: { def: '-1', desc: 'Loga queries mais lentas que N ms (-1 = off).' },
    data_directory: { def: '(PGDATA)', desc: 'Diretório dos dados do cluster.' },
  } },
  { type: 'haproxy', label: 'HAProxy · haproxy.cfg', re: /(^|\/)haproxy\.cfg$|\/haproxy\//, style: 'space', kb: {
    global: { def: '(seção)', desc: 'Parâmetros de processo (limites, logs, user).' },
    defaults: { def: '(seção)', desc: 'Valores padrão herdados por frontends/backends.' },
    frontend: { def: '(seção)', desc: 'Ponto de entrada: escuta e roteia requisições.' },
    backend: { def: '(seção)', desc: 'Grupo de servidores que atendem o tráfego.' },
    listen: { def: '(seção)', desc: 'Frontend+backend combinados num bloco.' },
    bind: { def: '', desc: 'Endereço:porta onde o frontend escuta.' },
    mode: { def: 'tcp', desc: 'Modo de proxy (http ou tcp).' },
    balance: { def: 'roundrobin', desc: 'Algoritmo de balanceamento (roundrobin, leastconn, source…).' },
    server: { def: '', desc: 'Define um servidor backend (nome ip:porta opções).' },
    option: { def: '', desc: 'Opções (httpchk, forwardfor, httplog…).' },
    timeout: { def: '', desc: 'Timeouts (connect, client, server) em ms/s.' },
    maxconn: { def: '2000', desc: 'Conexões simultâneas máximas.' },
    'default_backend': { def: '', desc: 'Backend usado quando nenhuma ACL casa.' },
  } },
  { type: 'netplan', label: 'netplan · YAML', re: /netplan\/.*\.ya?ml$/, style: 'colon', kb: {
    network: { def: '(raiz)', desc: 'Bloco raiz da config de rede.' },
    version: { def: '2', desc: 'Versão do formato netplan.' },
    renderer: { def: 'networkd', desc: 'Backend (networkd ou NetworkManager).' },
    ethernets: { def: '(bloco)', desc: 'Configura interfaces ethernet.' },
    wifis: { def: '(bloco)', desc: 'Configura interfaces Wi-Fi.' },
    bonds: { def: '(bloco)', desc: 'Agregação de links (bonding).' },
    vlans: { def: '(bloco)', desc: 'Interfaces VLAN.' },
    dhcp4: { def: 'false', desc: 'Habilita DHCP IPv4 na interface.' },
    dhcp6: { def: 'false', desc: 'Habilita DHCP IPv6.' },
    addresses: { def: '', desc: 'IPs estáticos (lista, ex.: 10.0.0.5/24).' },
    gateway4: { def: '', desc: 'Gateway IPv4 (use "routes" em versões novas).' },
    routes: { def: '', desc: 'Rotas estáticas (to/via).' },
    nameservers: { def: '', desc: 'DNS (addresses e search).' },
    mtu: { def: '1500', desc: 'Tamanho máximo do quadro.' },
  } },
  { type: 'named', label: 'BIND · named.conf', re: /(^|\/)named\.conf|\/bind\/|(^|\/)named\.conf\.\w+$/, style: 'space', kb: {
    options: { def: '(bloco)', desc: 'Opções globais do servidor DNS.' },
    zone: { def: '(bloco)', desc: 'Define uma zona DNS.' },
    type: { def: '', desc: 'Tipo da zona (master, slave, forward, hint).' },
    file: { def: '', desc: 'Arquivo de zona com os registros.' },
    'allow-query': { def: 'any', desc: 'Quem pode consultar.' },
    'allow-transfer': { def: 'none', desc: 'Quem pode fazer transferência de zona (AXFR).' },
    'allow-recursion': { def: '', desc: 'Quem pode usar recursão (evite "any" público).' },
    forwarders: { def: '', desc: 'Servidores para onde encaminhar consultas.' },
    listen_on: { def: '', desc: 'Interfaces/portas em que escuta.' },
    recursion: { def: 'yes', desc: 'Habilita recursão (desabilite em DNS autoritativo público).' },
    dnssec_validation: { def: 'auto', desc: 'Validação DNSSEC.' },
  } },
  { type: 'compose', label: 'Docker Compose', re: /(^|\/)(docker-)?compose\.ya?ml$/, style: 'colon', kb: {
    version: { def: '', desc: 'Versão do schema compose (obsoleto em specs novas).' },
    services: { def: '(bloco)', desc: 'Define os contêineres da stack.' },
    image: { def: '', desc: 'Imagem do contêiner (nome:tag).' },
    build: { def: '', desc: 'Constrói a imagem a partir de um Dockerfile.' },
    ports: { def: '', desc: 'Mapeia portas host:contêiner.' },
    volumes: { def: '', desc: 'Monta volumes/bind mounts.' },
    environment: { def: '', desc: 'Variáveis de ambiente do serviço.' },
    env_file: { def: '', desc: 'Arquivo .env com variáveis.' },
    depends_on: { def: '', desc: 'Ordem de início entre serviços.' },
    restart: { def: 'no', desc: 'Política de restart (always, unless-stopped, on-failure).' },
    networks: { def: '', desc: 'Redes às quais o serviço se conecta.' },
    command: { def: '', desc: 'Sobrescreve o comando padrão da imagem.' },
    healthcheck: { def: '', desc: 'Verificação de saúde do contêiner.' },
    deploy: { def: '', desc: 'Config de deploy (replicas, recursos) — Swarm.' },
  } },
  { type: 'dotenv', label: '.env · variáveis', re: /(^|\/)\.env(\.[\w.-]+)?$/, style: 'equals', kb: {} },
];

function findGenericByType(type) { return GENERIC_SERVICES.find((s) => s.type === type) || null; }

// ── Detecção do arquivo/tipo ──────────────────────────────────────────────
export function configTypeForFile(file) {
  if (!file) return null;
  const f = String(file).toLowerCase();
  if (/(^|\/)main\.cf$/.test(f)) return 'postfix-main';
  if (/(^|\/)master\.cf$/.test(f)) return 'postfix-master';
  if (/(^|\/)sshd_config(\.d\/.*)?$/.test(f) || /sshd_config\.d\//.test(f)) return 'sshd';
  if (/(^|\/)nginx\.conf$/.test(f) || /\/nginx\//.test(f)) return 'nginx';
  // Genéricos (match por NOME de arquivo) ANTES do Apache — senão o "/apache2/"
  // no caminho captura coisas como /etc/php/8.2/apache2/php.ini como apache.
  const g = GENERIC_SERVICES.find((svc) => svc.re.test(f));
  if (g) return g.type;
  if (/\/(apache2|httpd)\//.test(f) || /(^|\/)(apache2|httpd|ports)\.conf$/.test(f) || /sites-(available|enabled)\//.test(f)) return 'apache';
  return null;
}

// Detecta "vi/nano/vim ... <arquivo>" (com ou sem sudo) e devolve {editor,file,type}.
export function detectEditorCommand(cmd) {
  const line = String(cmd || '').trim();
  if (!line) return null;
  const m = line.match(/(?:^|\s)(?:sudo\s+(?:-\S+\s+)*)?(vim?|nano|pico|view|emacs|ee|joe|mcedit)\s+(?:-\S+\s+)*(["']?)([^\s"';|&]+)\2/i);
  if (!m) return null;
  const file = m[3];
  const type = configTypeForFile(file);
  if (!type) return null;
  return { editor: m[1].toLowerCase(), file, type };
}

// Extrai o nome do parâmetro a partir da linha sob o cursor.
export function extractParam(lineText, type) {
  if (!lineText) return null;

  // Serviços genéricos usam a linha ORIGINAL (preserva espaços).
  const gsvc = findGenericByType(type);
  if (gsvc) {
    const raw = String(lineText).trim();
    if (gsvc.style === 'cron') { return /^[\d*@]/.test(raw) ? raw : null; } // linha inteira; helpFor decodifica
    if (!raw || raw.startsWith('#') || raw.startsWith(';') || raw.startsWith('[')) return null;
    if (gsvc.style === 'equals') { const m = raw.match(/^(?:export\s+)?([A-Za-z0-9_.\- ]+?)\s*=/); return m ? m[1].trim().toLowerCase() : null; }
    if (gsvc.style === 'space') { const m = raw.match(/^([A-Za-z0-9_.\-]+)/); return m ? m[1].toLowerCase() : null; }
    if (gsvc.style === 'colon') { const m = raw.match(/^-?\s*([A-Za-z0-9_.\-]+)\s*:/); return m ? m[1].toLowerCase() : null; }
    return null; // json / colunas
  }

  const s = String(lineText).replace(/ /g, '');
  const trimmed = s.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  if (type === 'postfix-main') { const m = trimmed.match(/^([a-z0-9_]+)\s*=/i); return m ? m[1].toLowerCase() : null; }
  if (type === 'postfix-master') { const m = trimmed.match(/^([a-z0-9._-]+)\s+/i); return m ? m[1].toLowerCase() : null; }
  if (type === 'sshd') { const m = trimmed.match(/^([A-Za-z][A-Za-z0-9]+)\b/); return m ? m[1] : null; }
  if (type === 'apache') { const m = trimmed.match(/^<?\s*\/?\s*([A-Za-z][A-Za-z0-9_]+)/); return m ? m[1] : null; }
  if (type === 'nginx') { const m = trimmed.match(/^([a-z_]+)\b/i); return m ? m[1].toLowerCase() : null; }
  return null;
}

// Parseia a saída de `postconf -d` (linhas "param = valor") num mapa.
export function parsePostconf(text) {
  const map = {};
  String(text || '').split('\n').forEach((ln) => {
    const m = ln.match(/^([a-z0-9_]+)\s*=\s?(.*)$/i);
    if (m) map[m[1].toLowerCase()] = m[2];
  });
  return map;
}

// Parseia `sshd -T` (linhas "param valor", param em minúsculas) num mapa.
export function parseSshdT(text) {
  const map = {};
  String(text || '').split('\n').forEach((ln) => {
    const m = ln.trim().match(/^([a-z0-9]+)\s+(.*)$/i);
    if (m) map[m[1].toLowerCase()] = m[2];
  });
  return map;
}

// ── Base curada (postfix/sshd/apache/nginx) ────────────────────────────────
const POSTFIX_DESC = {
  myhostname: 'Nome de host (FQDN) totalmente qualificado desta máquina; usado em várias configs.',
  mydomain: 'Domínio local; default é o myhostname sem o primeiro componente.',
  myorigin: 'Domínio que aparece como origem de e-mails postados localmente.',
  mydestination: 'Lista de domínios que esta máquina considera como entrega local (final).',
  mynetworks: 'Faixas de IP confiáveis para relay sem autenticação. Cuidado: open relay se amplo demais.',
  relayhost: 'Host para onde encaminhar todo e-mail de saída (smarthost). Vazio = entrega direta via MX.',
  inet_interfaces: 'Interfaces de rede em que o Postfix escuta (all, loopback-only, IPs).',
  inet_protocols: 'Protocolos IP usados (ipv4, ipv6, all).',
  mailbox_size_limit: 'Tamanho máximo de uma caixa/arquivo de mailbox em bytes (0 = sem limite).',
  message_size_limit: 'Tamanho máximo de uma mensagem em bytes (cabeçalho + corpo).',
  smtpd_banner: 'Texto do banner SMTP exibido a quem conecta na porta 25.',
  smtpd_recipient_restrictions: 'Regras que decidem se um destinatário é aceito (anti-relay/anti-spam).',
  smtpd_relay_restrictions: 'Restrições de relay aplicadas antes das recipient_restrictions (Postfix 2.10+).',
  smtpd_tls_security_level: 'Nível de TLS no servidor SMTP (none, may, encrypt).',
  smtp_tls_security_level: 'Nível de TLS quando o Postfix age como cliente (entrega).',
  smtpd_tls_cert_file: 'Caminho do certificado TLS apresentado pelo servidor SMTP.',
  smtpd_tls_key_file: 'Caminho da chave privada TLS do servidor SMTP.',
  smtpd_sasl_auth_enable: 'Habilita autenticação SASL no SMTP (submissão autenticada).',
  alias_maps: 'Tabelas de aliases locais consultadas pelo agente local.',
  transport_maps: 'Tabelas que sobrescrevem o transporte/rota por destinatário ou domínio.',
  maximal_queue_lifetime: 'Tempo máximo que uma mensagem fica na fila antes de bounce (ex.: 5d).',
  header_checks: 'Tabela de expressões aplicadas aos cabeçalhos (filtragem/ações).',
};

const POSTFIX_MASTER_DESC = {
  smtp: 'Serviço SMTP. Na linha "smtp inet" é o servidor (porta 25); como cliente, entrega de saída.',
  submission: 'Submissão autenticada de e-mail (porta 587), tipicamente com TLS + SASL.',
  smtps: 'SMTP sobre TLS implícito (porta 465).',
  pickup: 'Coleta mensagens postadas localmente no diretório maildrop.',
  cleanup: 'Reescreve/valida cabeçalhos e injeta a mensagem na fila incoming.',
  qmgr: 'Gerenciador de fila: agenda e dispara as entregas.',
  local: 'Agente de entrega local (mailbox, aliases, .forward).',
  virtual: 'Agente de entrega para caixas virtuais.',
  bounce: 'Gera relatórios de não entrega (DSN).',
};

const SSHD_KB = {
  port: { def: '22', desc: 'Porta(s) em que o sshd escuta.' },
  permitrootlogin: { def: 'prohibit-password', desc: 'Se/como o root pode logar. CIS recomenda "no".' },
  passwordauthentication: { def: 'yes', desc: 'Permite autenticação por senha. CIS costuma desabilitar (no).' },
  pubkeyauthentication: { def: 'yes', desc: 'Permite autenticação por chave pública.' },
  permitemptypasswords: { def: 'no', desc: 'Permite login de contas com senha vazia. Mantenha "no".' },
  maxauthtries: { def: '6', desc: 'Máximo de tentativas de auth por conexão antes de cair.' },
  allowusers: { def: '(não definido)', desc: 'Whitelist de usuários que podem logar.', ex: 'AllowUsers deploy admin@10.0.0.5' },
  allowgroups: { def: '(não definido)', desc: 'Whitelist de grupos que podem logar.', ex: 'AllowGroups ssh-users admins' },
  x11forwarding: { def: 'no', desc: 'Permite encaminhamento de X11 sobre a sessão SSH.', ex: 'X11Forwarding no' },
  clientaliveinterval: { def: '0', desc: 'Intervalo (s) de keepalive do servidor; 0 = desligado.', ex: 'ClientAliveInterval 300' },
  clientalivecountmax: { def: '3', desc: 'Quantos keepalives sem resposta antes de derrubar a sessão.', ex: 'ClientAliveCountMax 2' },
  logingracetime: { def: '120', desc: 'Tempo (s) para concluir a autenticação antes de desconectar.', ex: 'LoginGraceTime 30' },
  usepam: { def: 'yes', desc: 'Usa PAM para autenticação/sessão.', ex: 'UsePAM yes' },
  banner: { def: 'none', desc: 'Arquivo exibido antes do login (aviso legal).', ex: 'Banner /etc/issue.net' },
  ciphers: { def: '(conjunto padrão OpenSSH)', desc: 'Algoritmos de cifra permitidos.', ex: 'Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com' },
};

const APACHE_KB = {
  servername: { def: '(não definido)', desc: 'Nome/host e porta que o servidor usa para se identificar.' },
  serveradmin: { def: '(não definido)', desc: 'E-mail do administrador exibido em páginas de erro.' },
  documentroot: { def: '/var/www/html', desc: 'Diretório raiz de onde os arquivos são servidos.' },
  listen: { def: '80', desc: 'Endereço/porta em que o Apache escuta.' },
  directoryindex: { def: 'index.html', desc: 'Arquivo servido quando se pede um diretório.' },
  allowoverride: { def: 'None', desc: 'Quais diretivas .htaccess são permitidas no diretório.' },
  errorlog: { def: 'logs/error_log', desc: 'Caminho do log de erros.' },
  customlog: { def: '(não definido)', desc: 'Define um log de acesso com formato específico.' },
  loglevel: { def: 'warn', desc: 'Verbosidade do log de erros (debug..emerg).' },
  options: { def: 'FollowSymLinks', desc: 'Recursos habilitados no diretório.' },
  require: { def: '(não definido)', desc: 'Controle de acesso 2.4 (ex.: "Require all granted").' },
  virtualhost: { def: '(bloco)', desc: 'Define um host virtual (site) com config própria.' },
  proxypass: { def: '(não definido)', desc: 'Encaminha requisições para um backend (reverse proxy).' },
};

const NGINX_KB = {
  worker_processes: { def: 'auto', desc: 'Número de processos worker. "auto" = núcleos de CPU.' },
  worker_connections: { def: '512', desc: 'Conexões por worker (bloco events).' },
  user: { def: 'nginx', desc: 'Usuário/grupo dos workers.' },
  listen: { def: '80', desc: 'Endereço/porta do server (ex.: 443 ssl).', ex: 'listen 443 ssl;' },
  server_name: { def: '""', desc: 'Nomes de host (vhost) deste bloco server.', ex: 'server_name exemplo.com www.exemplo.com;' },
  root: { def: 'html', desc: 'Diretório raiz dos arquivos servidos.', ex: 'root /var/www/html;' },
  index: { def: 'index.html', desc: 'Arquivos-índice tentados num diretório.', ex: 'index index.html index.php;' },
  location: { def: '(bloco)', desc: 'Regras para um caminho de URL.', ex: 'location /api/ {\n    proxy_pass http://127.0.0.1:8080;\n}' },
  proxy_pass: { def: '(não definido)', desc: 'Encaminha para um backend (reverse proxy).', ex: 'proxy_pass http://127.0.0.1:3000;' },
  proxy_set_header: { def: '(não definido)', desc: 'Define cabeçalhos ao backend (Host, X-Real-IP).', ex: 'proxy_set_header Host $host;\nproxy_set_header X-Real-IP $remote_addr;' },
  try_files: { def: '(não definido)', desc: 'Tenta arquivos na ordem; fallback (ex.: =404).', ex: 'try_files $uri $uri/ /index.html;' },
  return: { def: '(não definido)', desc: 'Retorna código/redirect (ex.: 301 https://...).', ex: 'return 301 https://$host$request_uri;' },
  rewrite: { def: '(não definido)', desc: 'Reescreve a URI via regex (last, break, redirect).', ex: 'rewrite ^/old/(.*)$ /new/$1 permanent;' },
  error_log: { def: 'logs/error.log', desc: 'Log de erros (debug..emerg).', ex: 'error_log /var/log/nginx/error.log warn;' },
  access_log: { def: 'logs/access.log', desc: 'Log de acesso (off desativa).', ex: 'access_log /var/log/nginx/access.log;' },
  ssl_certificate: { def: '(não definido)', desc: 'Certificado (cadeia) TLS.', ex: 'ssl_certificate /etc/letsencrypt/live/site/fullchain.pem;' },
  ssl_certificate_key: { def: '(não definido)', desc: 'Chave privada TLS.', ex: 'ssl_certificate_key /etc/letsencrypt/live/site/privkey.pem;' },
  ssl_protocols: { def: 'TLSv1.2 TLSv1.3', desc: 'Versões de TLS permitidas.', ex: 'ssl_protocols TLSv1.2 TLSv1.3;' },
  client_max_body_size: { def: '1m', desc: 'Tamanho máximo do corpo (uploads).' },
  keepalive_timeout: { def: '75s', desc: 'Tempo de conexão keep-alive.' },
  gzip: { def: 'off', desc: 'Habilita compressão gzip.' },
  include: { def: '(não definido)', desc: 'Inclui outro arquivo de config.', ex: 'include /etc/nginx/conf.d/*.conf;' },
  upstream: { def: '(bloco)', desc: 'Grupo de backends para balanceamento.', ex: 'upstream app {\n    server 10.0.0.1:8080;\n    server 10.0.0.2:8080;\n}' },
  add_header: { def: '(não definido)', desc: 'Adiciona cabeçalho de resposta (HSTS…).', ex: 'add_header Strict-Transport-Security "max-age=31536000" always;' },
  fastcgi_pass: { def: '(não definido)', desc: 'Backend FastCGI (ex.: PHP-FPM).', ex: 'fastcgi_pass unix:/run/php/php8.2-fpm.sock;' },
};

const SPECIAL_LABELS = {
  'postfix-main': 'Postfix · main.cf',
  'postfix-master': 'Postfix · master.cf',
  sshd: 'OpenSSH · sshd_config',
  apache: 'Apache · httpd',
  nginx: 'nginx · conf',
};

// Sintetiza um exemplo de uso de um parâmetro quando não há um explícito (kb.ex).
// style: 'equals' | 'space' | 'colon' | 'nginx' | 'apache'
function synthEx(param, def, style) {
  const raw = String(def == null ? '' : def);
  const v = (raw && !/^\(/.test(raw) && raw !== '') ? raw : 'valor';
  if (style === 'equals') return `${param} = ${v}`;
  if (style === 'colon') return `${param}: ${v}`;
  if (style === 'nginx') return `${param} ${v};`;
  return `${param} ${v}`; // space / apache / sshd
}

// Formata uma próxima execução de cron de forma curta (dd/mm HH:MM).
function fmtNextRun(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Rótulo legível para o cabeçalho do overlay.
export function typeLabel(type) {
  return SPECIAL_LABELS[type] || (findGenericByType(type)?.label) || 'Config';
}

/**
 * Monta o objeto de ajuda para um parâmetro.
 * @param {string} param
 * @param {string} type
 * @param {object} liveMaps  { postfix: {param:def}, sshd: {param:valorAtual} }
 */
export function helpFor(param, type, liveMaps = {}) {
  if (!param) return null;
  const key = param.toLowerCase();

  if (type === 'postfix-main') {
    const def = liveMaps.postfix ? liveMaps.postfix[key] : undefined;
    const desc = POSTFIX_DESC[key];
    if (def === undefined && !desc) return null;
    const dv = def !== undefined ? (def || '(vazio)') : '(?)';
    return { param, type, default: dv, desc: desc || 'Parâmetro do Postfix. Veja `man 5 postconf`.', ex: synthEx(param, def || key, 'equals'), source: def !== undefined ? 'postconf -d' : 'curado' };
  }
  if (type === 'postfix-master') {
    const desc = POSTFIX_MASTER_DESC[key];
    if (!desc) return null;
    return { param, type, default: '(serviço)', desc, ex: `${param}   unix  -  -  -  -  -  ${param}`, source: 'curado' };
  }
  if (type === 'sshd') {
    const kb = SSHD_KB[key];
    const live = liveMaps.sshd ? liveMaps.sshd[key] : undefined;
    if (!kb && live === undefined) return null;
    const dv = kb ? kb.def : '(?)';
    return { param, type, default: dv, current: live, desc: kb ? kb.desc : 'Diretiva do sshd. Veja `man sshd_config`.', ex: (kb && kb.ex) || synthEx(param, dv, 'space'), source: 'curado' + (live !== undefined ? ' + sshd -T' : '') };
  }
  if (type === 'apache') {
    const kb = APACHE_KB[key];
    if (!kb) return null;
    return { param, type, default: kb.def, desc: kb.desc, ex: kb.ex || synthEx(param, kb.def, 'apache'), source: 'curado' };
  }
  if (type === 'nginx') {
    const kb = NGINX_KB[key];
    if (!kb) return null;
    return { param, type, default: kb.def, desc: kb.desc, ex: kb.ex || synthEx(param, kb.def, 'nginx'), source: 'curado' };
  }

  // Serviços genéricos: usa KB curada; se não houver, fallback genérico
  // (mostra o helper mesmo assim, com dica de consultar a documentação).
  const gsvc = findGenericByType(type);
  if (gsvc) {
    if (gsvc.style === 'cron') {
      const c = parseCron(param); // param = linha inteira
      if (!c) return null;
      const runs = c.fields ? nextRuns(param, 3) : [];
      const when = runs.length ? ` · próximas: ${runs.map(fmtNextRun).join(', ')}` : '';
      const expr = param.split(/\s+/).slice(0, 5).join(' ');
      return { param: c.alias || expr, type, default: '(agendamento)', desc: `${c.text}${when}`, ex: '30 2 * * * /caminho/script.sh   # min hora dia mês dia-da-semana', source: 'cron' };
    }
    const kb = gsvc.kb[key];
    if (kb) return { param, type, default: kb.def || '(vazio)', desc: kb.desc, ex: kb.ex || synthEx(param, kb.def, gsvc.style === 'colon' ? 'colon' : gsvc.style === 'space' ? 'space' : 'equals'), source: 'curado' };
    return { param, type, default: '(?)', desc: `Diretiva de ${gsvc.label}. Consulte a documentação/man do serviço.`, ex: synthEx(param, 'valor', gsvc.style === 'colon' ? 'colon' : gsvc.style === 'space' ? 'space' : 'equals'), source: 'genérico' };
  }
  return null;
}

// Qual chave de helper pedir ao backend para este tipo de config (dados ao vivo).
export function helperKeyForType(type) {
  if (type === 'postfix-main' || type === 'postfix-master') return 'postfix-defaults';
  if (type === 'sshd') return 'sshd-effective';
  return null;
}
