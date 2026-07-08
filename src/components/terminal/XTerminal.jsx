/**
 * XTerminal.jsx
 * Componente React que renderiza um terminal xterm.js conectado via WebSocket
 * ao backend SSH do MSecOps. Suporta resize automático, cores 256 e web links.
 */
import React, { useRef, useEffect, useCallback, useMemo, useState, forwardRef, useImperativeHandle } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { AnimatePresence } from 'framer-motion';
import { Mail, Activity, Route, HardDrive, EyeOff, SlidersHorizontal, Wrench, HeartPulse, FolderTree } from 'lucide-react';
import MailParseOverlay from './MailParseOverlay';
import PingParseOverlay from './PingParseOverlay';
import TraceParseOverlay from './TraceParseOverlay';
import ConfigHelperOverlay from './ConfigHelperOverlay';
import StorageOverlay from './StorageOverlay';
import ToolParseOverlay from './ToolParseOverlay';
import FileBrowser from './FileBrowser';
import FileEditor from './FileEditor';
import RootModeFX from './RootModeFX';
import { parsePostfixLine, looksLikePostfix } from '../../utils/postfixLogParse';
import { parsePingLine, looksLikePing } from '../../utils/pingLineParse';
import { looksLikeTraceroute, parseTracerouteStart, parseTracerouteHop } from '../../utils/tracerouteParse';
import { detectEditorCommand, extractParam, helpFor, helperKeyForType, parsePostconf, parseSshdT } from '../../utils/configHelp';
import { parseStorage, storageKindForCmd } from '../../utils/storageParse';
import { toolKindForCmd, parseTool, isStreamingTool, LOG_KINDS, STREAM_KINDS, HEALTH_COMMAND, lsBaseDir, LS_EDIT_RE } from '../../utils/commandParsers';
import { checkDanger, checkGuard } from '../../utils/dangerCheck';
import { scanErrors, findCulprit } from '../../utils/errorHints';
import { explainCommand } from '../../utils/explainCommand';
import { api } from '../../lib/api';
import { basename } from '../../lib/sftpUtil';
import { parsersOff } from '../../lib/prefsUi';

/**
 * Props:
 *  - wsUrl: string — URL WebSocket (ws://host:port/ws/terminal)
 *  - connectionParams: { ip, port, protocol, displayName }
 *  - credentials: { username, password }
 *  - onStatusChange: (status: string, message?: string) => void
 *  - onDisconnect: () => void
 *  - isVisible: boolean — se a janela está visível (não minimizada)
 */
// remove sequencias ANSI/escape para gerar um log legivel
const stripAnsi = (s) => String(s || '')
  .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
  .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
  .replace(/\x1b[=>]/g, '')
  .replace(/\r/g, '');

const DEFAULT_TERM = {
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
  fontSize: 14,
  lineHeight: 1.2,
  background: '#0a0e1a',
  foreground: '#e2e8f0',
  cursor: '#06b6d4',
};

const XTerminal = forwardRef(({ wsUrl, connectionParams, credentials, onStatusChange, onServices, onDisconnect, onActivity, onCommand, onInput, termSettings = {}, isVisible = true, sessionLabel = '' }, ref) => {
  const S = { ...DEFAULT_TERM, ...termSettings };
  // onInput ref (broadcast) — keeps a stable closure inside the connect effect.
  const onInputRef = useRef(onInput); onInputRef.current = onInput;
  // Terminal colors follow the active theme unless the user explicitly picked
  // custom ones. The legacy blue defaults are treated as "auto / follow theme".
  const cssVar = (n, fb) => { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb; } catch { return fb; } };
  const isBlackBg = () => { try { return localStorage.getItem('tng_term_black') === '1'; } catch { return false; } };
  const [blackMode, setBlackMode] = useState(isBlackBg);
  const isFloatOverlays = () => { try { return localStorage.getItem('tng_overlay_float') === '1'; } catch { return false; } };
  const [floatOverlays, setFloatOverlays] = useState(isFloatOverlays);
  const effColors = () => {
    const auto = (v, legacy) => !v || v === legacy || v === 'auto';
    return {
      background: isBlackBg() ? '#000000' : (auto(S.background, '#0a0e1a') ? cssVar('--bg-1', '#070a16') : S.background),
      foreground: auto(S.foreground, '#e2e8f0') ? cssVar('--text', '#d7e6f5') : S.foreground,
      cursor: auto(S.cursor, '#06b6d4') ? cssVar('--cyber-primary', '#00f0ff') : S.cursor,
    };
  };
  const [bgColor, setBgColor] = useState(() => effColors().background);
  const termRef = useRef(null);
  const termInstanceRef = useRef(null);
  const fitAddonRef = useRef(null);
  const wsRef = useRef(null);
  const sessionLogRef = useRef('');
  const startedAtRef = useRef(null);
  const svcTimerRef = useRef(null);
  const sysinfoCbRef = useRef(null);
  const [mounted, setMounted] = useState(false);
  // ── Modo Parse (mail.log) ──
  const [parseOn, setParseOn] = useState(false);
  const [autoOn, setAutoOn] = useState(false);
  const [parsePinned, setParsePinned] = useState(false);
  const [mailEvents, setMailEvents] = useState([]);
  const [mailCounts, setMailCounts] = useState({});
  // Hide/show the floating parser toolbar (Ping/Trace/Disk/Mail).
  const [toolbarHidden, setToolbarHidden] = useState(() => localStorage.getItem('tng_parsebar_hidden') === '1');
  const toggleToolbar = () => setToolbarHidden((v) => { const n = !v; localStorage.setItem('tng_parsebar_hidden', n ? '1' : '0'); return n; });
  const parseOnRef = useRef(false);
  const suppressAutoRef = useRef(false);
  const parseLineBufRef = useRef('');
  const parsePendingRef = useRef([]);
  const parseCountsRef = useRef({});
  const parseFlushRef = useRef(null);
  const parseAutoTimerRef = useRef(null);
  const parseEvIdRef = useRef(0);
  const queueMapRef = useRef(new Map());
  const shownQueuesRef = useRef(new Set());
  // ── Modo Ping ──
  const [pingOn, setPingOn] = useState(false);
  const [pingAuto, setPingAuto] = useState(false);
  const [pingPinned, setPingPinned] = useState(false);
  const [pingSamples, setPingSamples] = useState([]);
  const pingOnRef = useRef(false);
  const pingSuppressRef = useRef(false);
  const pingPendingRef = useRef([]);
  const pingStateRef = useRef(null);
  const pingFlushRef = useRef(null);
  const pingAutoTimerRef = useRef(null);
  // ── Modo Root (efeito dourado com partículas) ──
  const [rootActive, setRootActive] = useState(false);
  const rootActiveRef = useRef(false);
  const rootPersistentRef = useRef(false);
  const rootOneShotRef = useRef(false);
  // ── Modo Traceroute ──
  const [traceOn, setTraceOn] = useState(false);
  const [traceAuto, setTraceAuto] = useState(false);
  const [tracePinned, setTracePinned] = useState(false);
  const [traceDest, setTraceDest] = useState(null);
  const [traceHops, setTraceHops] = useState([]);
  const traceOnRef = useRef(false);
  const traceDestRef = useRef(null);
  const traceHopsRef = useRef([]);
  const traceDirtyRef = useRef(false);
  const traceFlushRef = useRef(null);
  const traceAutoTimerRef = useRef(null);
  // ── Modo Storage (df/lsblk/fdisk/LVM/blkid) ──
  const [storageOn, setStorageOn] = useState(false);
  const [storageAuto, setStorageAuto] = useState(false);
  const [storagePinned, setStoragePinned] = useState(false);
  const [storageData, setStorageData] = useState(null);
  const storageOnRef = useRef(false);
  const storageDataRef = useRef(null);
  const storageDirtyRef = useRef(false);
  const storageFlushRef = useRef(null);
  const storageAutoTimerRef = useRef(null);

  // ── Diagnóstico (parsers genéricos de comando: ss, ip, ps, free, logs…) ──
  const [toolOn, setToolOn] = useState(false);
  const [toolAuto, setToolAuto] = useState(false);
  const [toolPinned, setToolPinned] = useState(false);
  const [toolData, setToolData] = useState(null);
  const toolOnRef = useRef(false);
  const toolDataRef = useRef(null);
  const toolDirtyRef = useRef(false);
  const toolFlushRef = useRef(null);
  const toolAutoTimerRef = useRef(null);
  // Parser IA: a IA avalia a saída capturada e mostra uma análise (narrativa +
  // achados + comandos sugeridos), diferente da tabela do parser local.
  const [aiParser, setAiParser] = useState(() => { try { return localStorage.getItem('tng_ai_parser') === '1'; } catch { return false; } });
  const [aiBusy, setAiBusy] = useState(false);
  const lastCaptureRef = useRef(null);   // { command, output, id }
  const captureSeqRef = useRef(0);
  const aiAnalyzedIdRef = useRef(0);
  // SFTP / navegador de arquivos
  const [filesOpen, setFilesOpen] = useState(false);
  const [editPath, setEditPath] = useState(null); // arquivo aberto no editor via link do `ls`
  const sftpPendingRef = useRef(new Map()); // reqId -> handler { onResult,onError,onMeta,onChunk,onEof,onAck,onDone }
  const sftpSeqRef = useRef(0);
  const httpPendingRef = useRef(new Map()); // reqId -> resolver (fetch via SSH)
  const bgPendingRef = useRef(new Map());   // reqId -> resolver (exec em background: health check)
  const cwdRef = useRef('');  // diretório atual extraído do prompt (p/ resolver caminhos do `ls`)
  const homeRef = useRef(''); // home resolvido (expandir ~)
  const lsDirRef = useRef(''); // diretório do último `ls` (p/ links clicáveis no terminal)
  const lsLinkActiveRef = useRef(false); // habilita links de arquivo no terminal após um `ls`
  const openFileRef = useRef(null); // ponteiro p/ openRemoteFile (usado pelo link provider do xterm)
  const parsersOffRef = useRef(parsersOff()); // parsers desligados pelo usuário
  useEffect(() => {
    const sync = () => { parsersOffRef.current = parsersOff(); };
    window.addEventListener('tng:parsers', sync);
    return () => window.removeEventListener('tng:parsers', sync);
  }, []);
  const inputLineRef = useRef('');  // linha digitada (guard + arming do parser na 1ª vez)
  const typedCmdRef = useRef('');   // último comando digitado (fallback p/ detecção do parser)
  const [dangerConfirm, setDangerConfirm] = useState(null); // { line, reason, hint } — modal de confirmação
  // ── Sonda ativa (ping|trace|null) + "em execução" p/ disparo manual ──
  // activeProbe torna ping e traceroute mutuamente exclusivos: enquanto um
  // comando ping está ativo, o painel de traceroute (auto) não aparece.
  const [activeProbe, setActiveProbe] = useState(null);
  const activeProbeRef = useRef(null);
  const [pingRunning, setPingRunning] = useState(false);
  const pingRunIdleRef = useRef(null);
  const [traceRunning, setTraceRunning] = useState(false);
  const traceRunIdleRef = useRef(null);
  const [mailTailRunning, setMailTailRunning] = useState(false);
  const mailTailIdleRef = useRef(null);
  // ── Sondas manuais (canal SSH paralelo no backend) ──
  // *Manual = há uma sonda nossa ativa (mostra botão "parar"); *ProbeRef guarda
  // o id p/ poder enviar probe_stop; probeBufs acumula linhas por id.
  const [pingManual, setPingManual] = useState(false);
  const [traceManual, setTraceManual] = useState(false);
  const [mailManual, setMailManual] = useState(false);
  const pingProbeRef = useRef(null);
  const traceProbeRef = useRef(null);
  const mailProbeRef = useRef(null);
  const probeSeqRef = useRef(0);
  const probeBufsRef = useRef({});
  // ── Helper de config (editores) ──
  const [editorType, setEditorType] = useState(null);
  const [editorFile, setEditorFile] = useState(null);
  const [helpData, setHelpData] = useState(null);
  const pendingEditorRef = useRef(null);
  const editorActiveRef = useRef(false);
  const postfixMapRef = useRef(null);
  const sshdMapRef = useRef(null);
  const helperReqRef = useRef(new Set());
  const lastParamRef = useRef(null);

  // ── Inicializar terminal ──
  useEffect(() => {
    if (!termRef.current || termInstanceRef.current) return;

    const ec = effColors();
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: S.fontSize,
      fontFamily: S.fontFamily,
      lineHeight: S.lineHeight,
      scrollback: 5000,
      allowProposedApi: true,
      theme: {
        background: ec.background,
        foreground: ec.foreground,
        cursor: ec.cursor,
        cursorAccent: ec.background,
        selectionBackground: '#06b6d440',
        selectionForeground: '#ffffff',
        black: '#1e293b',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#e2e8f0',
        brightBlack: '#475569',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#f8fafc',
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(termRef.current);

    // ── Link provider: torna nomes de arquivos editáveis (.conf/.yaml/…) na
    //    saída do `ls` CLICÁVEIS direto no terminal — abrem o editor. ──
    try {
      term.registerLinkProvider({
        provideLinks(y, cb) {
          if (!lsLinkActiveRef.current) return cb(undefined);
          const buf = term.buffer.active;
          const lineObj = buf.getLine(y - 1);
          if (!lineObj) return cb(undefined);
          const text = lineObj.translateToString(true);
          const re = /(\S+\.(?:conf|cfg|txt|tom|toml|ya?ml|ini|env|json|properties|list|rules))\b/gi;
          const links = []; let m;
          while ((m = re.exec(text)) !== null) {
            const name = m[1].replace(/^.*\//, '').replace(/[*/=@|]$/, '');
            if (!LS_EDIT_RE.test(name)) continue;
            const startX = m.index + 1;
            const endX = m.index + m[1].length + 1;
            const raw = m[1].replace(/[*/=@|]$/, '');
            links.push({
              range: { start: { x: startX, y }, end: { x: endX, y } },
              text: m[1],
              activate: () => {
                const dir = lsDirRef.current || cwdRef.current || '';
                const p = raw.startsWith('/') ? raw : (dir ? `${dir.replace(/\/+$/, '')}/${raw}` : raw);
                openFileRef.current?.(p);
              },
            });
          }
          cb(links.length ? links : undefined);
        },
      });
    } catch {}

    // Fit inicial (pequeno delay para o DOM estar pronto)
    setTimeout(() => {
      try { fitAddon.fit(); } catch {}
    }, 100);

    // ── Comportamento estilo PuTTY ───────────────────────────────────
    // Cópia: writeText (HTTPS) com fallback execCommand (funciona em HTTP).
    const execCopy = (text) => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
      } catch {}
    };
    const copyText = (text) => {
      if (!text) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => execCopy(text));
      } else { execCopy(text); }
    };
    const el = termRef.current;
    // Ao soltar o mouse com algo selecionado -> copia (1 gesto, evita roubar foco no drag).
    const onMouseUp = () => {
      const sel = term.getSelection();
      if (sel && sel.length) copyText(sel);
    };
    el?.addEventListener('mouseup', onMouseUp);
    // Botão direito -> cola. Em contexto seguro (HTTPS/localhost) cola direto;
    // em HTTP o navegador bloqueia a leitura do clipboard, então deixamos o
    // menu nativo do navegador (com "Colar") aparecer como fallback.
    const onContextMenu = (e) => {
      if (navigator.clipboard && navigator.clipboard.readText) {
        e.preventDefault();
        navigator.clipboard.readText().then((text) => { if (text) term.paste(text); }).catch(() => {});
      }
    };
    el?.addEventListener('contextmenu', onContextMenu);

    termInstanceRef.current = term;
    fitAddonRef.current = fitAddon;
    setMounted(true);

    return () => {
      el?.removeEventListener('mouseup', onMouseUp);
      el?.removeEventListener('contextmenu', onContextMenu);
      term.dispose();
      termInstanceRef.current = null;
      fitAddonRef.current = null;
      setMounted(false);
    };
  }, []);

  // ── Conectar WebSocket quando terminal está pronto e temos credenciais ──
  useEffect(() => {
    if (!mounted || !wsUrl || !credentials?.username || !termInstanceRef.current) return;

    const term = termInstanceRef.current;
    term.clear();
    term.writeln(`\x1b[36m● Conectando a ${connectionParams?.ip}:${connectionParams?.port || 22}...\x1b[0m`);
    term.writeln('');

    onStatusChange?.('connecting');

    // ── Modo Parse: parser do stream de saída (mail.log do Postfix) ──
    parseLineBufRef.current = '';
    parsePendingRef.current = [];
    queueMapRef.current = new Map();
    shownQueuesRef.current = new Set();
    pingPendingRef.current = [];
    pingStateRef.current = null;
    setPingSamples([]);
    traceDestRef.current = null; traceHopsRef.current = []; traceDirtyRef.current = false;
    setTraceDest(null); setTraceHops([]);
    pendingEditorRef.current = null; editorActiveRef.current = false; lastParamRef.current = null;
    postfixMapRef.current = null; sshdMapRef.current = null; helperReqRef.current = new Set();
    setEditorType(null); setEditorFile(null); setHelpData(null);
    rootPersistentRef.current = false; rootOneShotRef.current = false; rootActiveRef.current = false; setRootActive(false);
    storageDataRef.current = null; storageDirtyRef.current = false; setStorageData(null); setStorageAuto(false);
    toolDataRef.current = null; toolDirtyRef.current = false; setToolData(null); setToolAuto(false);
    activeProbeRef.current = null; setActiveProbe(null);
    setPingRunning(false); setTraceRunning(false); setMailTailRunning(false);
    pingProbeRef.current = null; traceProbeRef.current = null; mailProbeRef.current = null;
    probeBufsRef.current = {};
    setPingManual(false); setTraceManual(false); setMailManual(false);
    let probeMode = null;   // 'ping' | 'trace' | null — dirigido pelo comando rodado
    let storageCap = null;  // { kind, lines: [] } — captura da saída de um comando de storage
    let toolCap = null;     // { kind, lines: [] } — captura p/ parsers de diagnóstico (ss, ip, ps…)
    let cmdCap = null;      // { command, lines: [] } — captura genérica p/ o Auto-Pilot da IA
    let toolJustSet = false; // evita sobrescrever um parse rico com dicas de erro
    let idleTimer = null;   // finaliza a captura quando a saída para (sem esperar o próximo prompt)
    const INTERACTIVE_RE = /^(sudo\s+)?(vim?|nano|pico|view|emacs|ee|joe|mcedit|less|more|man|top|htop|watch|ssh|telnet|mysql|psql|python3?|node|irb|tmux|screen)\b/;
    const TOOL_BUMP = () => {
      if (!toolOnRef.current) setToolAuto(true);
      if (toolAutoTimerRef.current) clearTimeout(toolAutoTimerRef.current);
      toolAutoTimerRef.current = setTimeout(() => setToolAuto(false), 14000);
    };
    const showToolData = (data) => { if (!data) return; toolDataRef.current = data; toolDirtyRef.current = true; toolJustSet = true; TOOL_BUMP(); };
    // Parseia a captura atual (bloco ou stream). Não limpa toolCap.
    const parseToolNow = () => {
      if (!toolCap || !toolCap.lines.length) return false;
      const parsed = parseTool(toolCap.kind, toolCap.lines, { streaming: !!toolCap.streaming, cmd: toolCap.cmd, cwd: cwdRef.current });
      if (!parsed) return false;
      // p/ comandos comuns, anexa dicas de erro (logs/métricas/health já tratam por conta própria)
      if (!STREAM_KINDS.has(toolCap.kind) && toolCap.kind !== 'health') {
        const hints = scanErrors(toolCap.lines.join('\n'));
        if (hints.length) parsed.sections = [...(parsed.sections || []), ...hints.map((h) => ({ type: 'note', tone: h.tone, title: h.title, text: h.hint }))];
      }
      showToolData(parsed);
      return true;
    };
    // Reparse ao vivo (flush ~350ms): vale p/ streams (tail -f) E p/ comandos
    // normais — assim o painel aparece já durante o 1º comando, sem esperar o
    // próximo prompt nem o idle (corrige o "só funciona na 2ª vez").
    const liveParseTool = () => { if (toolCap && toolCap._dirty) { toolCap._dirty = false; parseToolNow(); } };
    const finalizeTool = () => { toolJustSet = false; parseToolNow(); toolCap = null; };
    const finalizeCmd = () => {
      if (cmdCap && cmdCap.command && onCommand) {
        try { onCommand({ command: cmdCap.command, output: cmdCap.lines.join('\n').slice(-8000) }); } catch {}
      }
      // Guarda a última captura (comando + saída) p/ a Análise IA, exceto streams.
      if (cmdCap && cmdCap.command && !(cmdCap.kind && STREAM_KINDS.has(cmdCap.kind))) {
        lastCaptureRef.current = { command: cmdCap.command, output: cmdCap.lines.join('\n'), id: ++captureSeqRef.current };
      }
      // Dicas de erro p/ comandos comuns — SÓ se o usuário optar (tng_error_hints).
      // Desligado por padrão p/ não poluir a tela a cada comando. Sem isso, a
      // Análise IA (Parser IA) também não dispara em comandos comuns (cat/ls).
      const hintsOn = (() => { try { return localStorage.getItem('tng_error_hints') === '1'; } catch { return false; } })();
      if (hintsOn && !toolJustSet && cmdCap && cmdCap.lines.length && !(cmdCap.kind && (STREAM_KINDS.has(cmdCap.kind) || cmdCap.kind === 'health'))) {
        const out = cmdCap.lines.join('\n');
        const hints = scanErrors(out);
        if (hints.length) {
          const sections = [];
          const culprit = findCulprit(cmdCap.command, out);
          if (culprit) sections.push({ type: 'note', tone: 'warn', title: 'Parâmetro com erro', text: `${cmdCap.command}\n→ ${culprit.token}` });
          sections.push(...hints.map((h) => ({ type: 'note', tone: h.tone, title: h.title, text: h.hint })));
          showToolData({ title: 'Possível problema', icon: 'alert', sections });
        }
      }
      cmdCap = null;
    };
    const STORAGE_BUMP = () => {
      if (!storageOnRef.current) setStorageAuto(true);
      if (storageAutoTimerRef.current) clearTimeout(storageAutoTimerRef.current);
      storageAutoTimerRef.current = setTimeout(() => setStorageAuto(false), 12000);
    };
    const finalizeStorage = () => {
      if (storageCap && storageCap.lines.length) {
        const parsed = parseStorage(storageCap.kind, storageCap.lines);
        if (parsed) { storageDataRef.current = parsed; storageDirtyRef.current = true; STORAGE_BUMP(); }
      }
      storageCap = null;
    };
    // Aviso de comando perigoso + explicação das flags, no mesmo painel.
    const warnDanger = (d, cmd) => {
      const ex = explainCommand(cmd);
      const sections = [{ type: 'note', tone: d.level === 'critical' ? 'danger' : 'warn', title: (d.level === 'critical' ? '⚠ CRÍTICO · ' : '⚠ Atenção · ') + d.reason, text: d.hint }];
      if (ex && ex.parts.length) sections.push({ type: 'kv', items: [{ k: ex.bin, v: ex.desc, tone: 'dim' }, ...ex.parts.map((p) => ({ k: p.token, v: p.desc, tone: 'accent' }))] });
      showToolData({ title: 'Comando perigoso', icon: 'alert', sections });
    };
    const pushMailEvent = (ev) => {
      ev._id = ++parseEvIdRef.current;
      parsePendingRef.current.push(ev);
      parseCountsRef.current[ev.kind] = (parseCountsRef.current[ev.kind] || 0) + 1;
      if (!suppressAutoRef.current) setAutoOn(true);
      if (parseAutoTimerRef.current) clearTimeout(parseAutoTimerRef.current);
      parseAutoTimerRef.current = setTimeout(() => setAutoOn(false), 8000);
      markMailRunning();
    };
    // ── Modo Ping: acumula amostras de RTT/perda do comando ping ──
    const pushPing = (sample) => {
      pingPendingRef.current.push(sample);
      if (!pingSuppressRef.current) setPingAuto(true);
      if (pingAutoTimerRef.current) clearTimeout(pingAutoTimerRef.current);
      pingAutoTimerRef.current = setTimeout(() => setPingAuto(false), 7000);
    };
    // "Em execução": liga ao chegar linhas e desliga após um intervalo ocioso
    // (ou no resumo, no caso do ping). Serve p/ desabilitar o disparo manual.
    // O idle só desliga o "running" quando NÃO há sonda manual ativa (a sonda
    // controla o próprio ciclo via probe_done/probe_stop).
    const markPingRunning = () => {
      setPingRunning(true);
      if (pingRunIdleRef.current) clearTimeout(pingRunIdleRef.current);
      pingRunIdleRef.current = setTimeout(() => { if (!pingProbeRef.current) setPingRunning(false); }, 4500);
    };
    const stopPingRunning = () => { if (pingRunIdleRef.current) { clearTimeout(pingRunIdleRef.current); pingRunIdleRef.current = null; } if (!pingProbeRef.current) setPingRunning(false); };
    const markTraceRunning = () => {
      setTraceRunning(true);
      if (traceRunIdleRef.current) clearTimeout(traceRunIdleRef.current);
      traceRunIdleRef.current = setTimeout(() => { if (!traceProbeRef.current) setTraceRunning(false); }, 6000);
    };
    const markMailRunning = () => {
      setMailTailRunning(true);
      if (mailTailIdleRef.current) clearTimeout(mailTailIdleRef.current);
      mailTailIdleRef.current = setTimeout(() => { if (!mailProbeRef.current) setMailTailRunning(false); }, 20000);
    };
    // Núcleo do parse de ping (sem o guard de probeMode). Usado tanto pela saída
    // da shell quanto pela sonda paralela (canal SSH dedicado).
    const parsePingInto = (line) => {
      const ev = parsePingLine(line);
      if (!ev) return;
      let st = pingStateRef.current;
      if (ev.type === 'start') { st = pingStateRef.current = { host: ev.host || ev.ip, ip: ev.ip || ev.host }; pushPing({ kind: 'start', host: st.host, ip: st.ip }); markPingRunning(); return; }
      if (!st) st = pingStateRef.current = { host: ev.host || null, ip: ev.ip || null };
      if (ev.type === 'reply') { if (ev.host && !st.host) st.host = ev.host; pushPing({ kind: 'reply', seq: ev.seq, ttl: ev.ttl, time: ev.time, host: st.host }); markPingRunning(); }
      else if (ev.type === 'loss') { pushPing({ kind: 'loss', seq: ev.seq != null ? ev.seq : null, reason: ev.reason || null }); markPingRunning(); }
      else if (ev.type === 'summary') { pushPing({ kind: 'summary', transmitted: ev.transmitted, received: ev.received, lossPct: ev.lossPct, min: ev.min, avg: ev.avg, max: ev.max, mdev: ev.mdev }); stopPingRunning(); }
    };
    const feedPing = (line) => {
      if (parsersOffRef.current.has('ping')) return;
      if (probeMode === 'trace') return;
      if (!looksLikePing(line)) return;
      parsePingInto(line);
    };
    // ── Modo Root: detecta prompt/comandos para acender o efeito dourado ──
    const syncRoot = () => {
      const next = rootPersistentRef.current || rootOneShotRef.current;
      if (next !== rootActiveRef.current) { rootActiveRef.current = next; setRootActive(next); }
    };
    const detectRootAndCmd = (line) => {
      const pm = line.match(/([A-Za-z0-9._-]+)@([A-Za-z0-9._-]+)[^\n]*?([#$])\s?([^\n]*)$/);
      if (!pm) return false;
      finalizeStorage(); // novo prompt => a captura do comando anterior terminou
      finalizeTool();     // idem para parsers de diagnóstico
      finalizeCmd();      // idem para a captura genérica do Auto-Pilot
      const user = pm[1];
      const sigil = pm[3];
      const cmd = (pm[4] || '').trim();
      // Extrai o diretório atual do prompt (PS1 comum: user@host:~/dir$ ou /etc#),
      // usado p/ resolver caminhos relativos do parser de `ls`.
      const cwdM = line.match(/([~/][^\s:#$]*)\s*[#$]\s/);
      if (cwdM) cwdRef.current = cwdM[1];
      rootOneShotRef.current = false; // novo prompt => comando anterior terminou
      rootPersistentRef.current = (sigil === '#') || (user.toLowerCase() === 'root');
      // ping/traceroute mutuamente exclusivos, dirigidos pelo comando.
      // Tira prefixos comuns (sudo/time/stdbuf/env VAR=...) p/ detectar o binário
      // real — antes "sudo ping" caía no else e zerava o modo, deixando o
      // traceroute "vazar" e abrir o painel dele durante o ping.
      const bare = cmd.replace(/^(?:sudo(?:\s+-\S+)*\s+|time\s+|stdbuf(?:\s+-\S+)*\s+|env\s+\S+=\S+\s+)+/i, '');
      const setProbe = (p) => {
        probeMode = p;
        if (activeProbeRef.current !== p) { activeProbeRef.current = p; setActiveProbe(p); }
        // ao iniciar uma sonda, esconde o auto da outra imediatamente
        if (p === 'ping') setTraceAuto(false);
        else if (p === 'trace') setPingAuto(false);
      };
      if (/^ping6?\b/.test(bare)) setProbe('ping');
      else if (/^(traceroute6?|tracepath6?|tracert|mtr)\b/.test(bare)) setProbe('trace');
      else if (cmd) setProbe(null);
      // Comando EFETIVO p/ detecção do parser: o do prompt, ou (fallback) o que o
      // usuário acabou de digitar — corrige o "parser só aparece na 2ª vez"
      // quando o prompt não traz o comando embutido.
      const effCmd = cmd || typedCmdRef.current || '';
      const off = parsersOffRef.current;
      // captura de comandos de storage
      const sk = effCmd ? storageKindForCmd(effCmd) : null;
      storageCap = (sk && !off.has('storage')) ? { kind: sk, lines: [] } : null;
      // captura p/ parsers de diagnóstico (ss, ip, ps, free, journalctl, dmesg…)
      const isHealth = effCmd ? /###TNGHC###/.test(effCmd) : false;
      let tk = isHealth ? 'health' : (effCmd ? toolKindForCmd(effCmd) : null);
      if (tk && tk !== 'health' && off.has(tk)) tk = null; // parser desativado pelo usuário
      const streamingCmd = effCmd ? isStreamingTool(effCmd) : false;
      // STREAM: logs seguidos (tail -f, journalctl -f, dmesg -w) E métricas com
      // intervalo (vmstat/iostat/mpstat N) viram buffer rolante reparseado ao
      // vivo (sparklines). Demais streamings (top) ficam de fora.
      if (tk && (!streamingCmd || STREAM_KINDS.has(tk))) {
        toolCap = { kind: tk, cmd: effCmd, lines: [], streaming: streamingCmd && STREAM_KINDS.has(tk), max: 4000, _dirty: false };
      } else { toolCap = null; }
      // Links de arquivo no terminal: ativos logo após um `ls`, com o diretório alvo.
      if (tk === 'ls') { lsLinkActiveRef.current = true; lsDirRef.current = lsBaseDir(effCmd, cwdRef.current); }
      else if (effCmd) { lsLinkActiveRef.current = false; }
      typedCmdRef.current = ''; // consumido — evita rearmar no próximo prompt vazio
      // aviso de comando perigoso (rm -rf, mkfs, dd, fork bomb…)
      if (cmd) { const d = checkDanger(cmd); if (d) warnDanger(d, cmd); }
      // Captura genérica p/ IA: comandos não-interativos e não-editores.
      cmdCap = (cmd && !INTERACTIVE_RE.test(cmd) && !detectEditorCommand(cmd)) ? { command: cmd, kind: tk, lines: [] } : null;
      if (cmd) {
        const ed = detectEditorCommand(cmd);
        if (ed && !off.has('config')) {
          pendingEditorRef.current = ed;
        } else {
          pendingEditorRef.current = null;
          if (/^sudo\s+/.test(cmd) && !/^sudo\s+(-i\b|-s\b|su\b|bash\b|sh\b|zsh\b|-\s)/.test(cmd)) {
            rootOneShotRef.current = true;
          }
        }
      }
      syncRoot();
      return true;
    };
    // ── Modo Traceroute: acumula hops da saída ──
    const bumpTraceAuto = () => {
      if (!traceOnRef.current) setTraceAuto(true);
      if (traceAutoTimerRef.current) clearTimeout(traceAutoTimerRef.current);
      traceAutoTimerRef.current = setTimeout(() => setTraceAuto(false), 9000);
    };
    const parseTraceInto = (line) => {
      const start = parseTracerouteStart(line);
      if (start) { traceDestRef.current = start; traceHopsRef.current = []; traceDirtyRef.current = true; bumpTraceAuto(); markTraceRunning(); return; }
      const hop = parseTracerouteHop(line);
      if (hop) {
        const arr = traceHopsRef.current;
        const idx = arr.findIndex((h) => h.hop === hop.hop);
        if (idx >= 0) arr[idx] = hop; else arr.push(hop);
        traceDirtyRef.current = true;
        bumpTraceAuto();
        markTraceRunning();
      }
    };
    const feedTrace = (line) => {
      if (parsersOffRef.current.has('trace')) return;
      if (probeMode === 'ping') return;
      if (!looksLikeTraceroute(line)) return;
      parseTraceInto(line);
    };
    // Processa uma linha do mail.log (Postfix). Usado pela shell e pela sonda tail.
    const processMailLine = (line) => {
      if (!looksLikePostfix(line)) return;
      const ev = parsePostfixLine(line);
      if (!ev) return;

      // ── Correlação por queue id: de/para/origem/status se espalham por
      //    várias linhas. Acumulamos por fila e enriquecemos cada evento. ──
      const qid = ev.queueId;
      if (qid) {
        const rec = queueMapRef.current.get(qid) || {};
        if (ev.from) rec.from = ev.from;
        if (ev.to) rec.to = ev.to;
        if (ev.relay) rec.relay = ev.relay;
        if (ev.client) rec.client = ev.client;
        if (ev.status) rec.status = ev.status;
        if (ev.code) rec.code = ev.code;
        if (ev.reason) rec.reason = ev.reason;
        queueMapRef.current.set(qid, rec);
        if (queueMapRef.current.size > 600) {
          const k = queueMapRef.current.keys().next().value;
          queueMapRef.current.delete(k); shownQueuesRef.current.delete(k);
        }
        ev.from = ev.from || rec.from || null;
        ev.to = ev.to || rec.to || null;
        ev.relay = ev.relay || rec.relay || null;
        ev.client = ev.client || rec.client || null;
      }

      const DELIVERY = ev.kind === 'sent' || ev.kind === 'deferred' || ev.kind === 'bounced' || ev.kind === 'reject';
      if (DELIVERY) {
        if (qid) shownQueuesRef.current.add(qid);
        pushMailEvent(ev);
      } else if (ev.kind === 'removed') {
        const rec = qid ? (queueMapRef.current.get(qid) || {}) : {};
        const st = rec.status;
        if (st === 'sent') ev.kind = 'sent';
        else if (st === 'bounced' || st === 'expired') ev.kind = 'bounced';
        else if (st === 'deferred') ev.kind = 'deferred';
        if (ev.kind !== 'removed' && !(qid && shownQueuesRef.current.has(qid))) {
          ev.reason = ev.reason || rec.reason || null;
          ev.code = ev.code || rec.code || null;
          if (qid) shownQueuesRef.current.add(qid);
          pushMailEvent(ev);
        }
      } else if (ev.kind === 'connect' || ev.kind === 'disconnect' || ev.kind === 'warning' || ev.kind === 'bounce') {
        pushMailEvent(ev);
      }
      // 'received' / 'info' (queued): só alimentam a correlação, sem card.
    };
    // Processa a saída de uma sonda paralela (probe_output) por modo.
    const feedProbe = (id, mode, chunk) => {
      const prev = probeBufsRef.current[id] || '';
      const buf = prev + stripAnsi(chunk);
      const parts = buf.split('\n');
      probeBufsRef.current[id] = parts.pop();
      for (const line of parts) {
        if (!line) continue;
        if (mode === 'ping') parsePingInto(line);
        else if (mode === 'trace') parseTraceInto(line);
        else if (mode === 'tail') processMailLine(line);
      }
    };
    // Encerra a sonda (probe_done/probe_error): limpa estado manual associado.
    const endProbe = (id) => {
      delete probeBufsRef.current[id];
      if (pingProbeRef.current === id) { pingProbeRef.current = null; setPingManual(false); setPingRunning(false); }
      if (traceProbeRef.current === id) { traceProbeRef.current = null; setTraceManual(false); setTraceRunning(false); }
      if (mailProbeRef.current === id) { mailProbeRef.current = null; setMailManual(false); setMailTailRunning(false); }
    };
    const feedParser = (chunk) => {
      const buf = parseLineBufRef.current + stripAnsi(chunk);
      const parts = buf.split('\n');
      parseLineBufRef.current = parts.pop();
      const mailActive = !(suppressAutoRef.current && !parseOnRef.current) && !parsersOffRef.current.has('mail');
      for (const line of parts) {
        if (!line) continue;
        feedPing(line);
        feedTrace(line);
        const wasPrompt = detectRootAndCmd(line);
        if (storageCap && !wasPrompt) storageCap.lines.push(line);
        if (toolCap && !wasPrompt) {
          toolCap.lines.push(line);
          if (toolCap.lines.length > toolCap.max) toolCap.lines = toolCap.lines.slice(-toolCap.max);
          toolCap._dirty = true; // reparse ao vivo no flush (também p/ não-stream → painel aparece já no 1º comando)
        }
        if (cmdCap && !wasPrompt && cmdCap.lines.length < 600) cmdCap.lines.push(line);
        if (mailActive) processMailLine(line);
      }
      // Log em stream (tail -f) é reparseado ao vivo pelo flush (350ms), não aqui.
      // Finaliza capturas quando a saída para. Captura em STREAM (tail -f) NÃO é
      // finalizada por idle — só encerra no próximo prompt (Ctrl-C).
      const idleHasWork = storageCap || (toolCap && !toolCap.streaming) || cmdCap;
      if (idleHasWork) {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => { finalizeStorage(); if (toolCap && !toolCap.streaming) finalizeTool(); finalizeCmd(); }, 650);
      }
      if (parseLineBufRef.current.length > 8000) parseLineBufRef.current = parseLineBufRef.current.slice(-2000);
    };
    if (parseFlushRef.current) clearInterval(parseFlushRef.current);
    parseFlushRef.current = setInterval(() => {
      if (!parsePendingRef.current.length) return;
      const batch = parsePendingRef.current.splice(0).reverse();
      setMailEvents(prev => [...batch, ...prev].slice(0, 200));
      setMailCounts({ ...parseCountsRef.current });
    }, 400);
    if (pingFlushRef.current) clearInterval(pingFlushRef.current);
    pingFlushRef.current = setInterval(() => {
      if (!pingPendingRef.current.length) return;
      const batch = pingPendingRef.current.splice(0);
      setPingSamples(prev => {
        let next = prev;
        for (const x of batch) { if (x.kind === 'start') next = []; else next = next.concat(x); }
        return next.slice(-400);
      });
    }, 350);
    if (traceFlushRef.current) clearInterval(traceFlushRef.current);
    traceFlushRef.current = setInterval(() => {
      if (!traceDirtyRef.current) return;
      traceDirtyRef.current = false;
      setTraceDest(traceDestRef.current);
      setTraceHops(traceHopsRef.current.slice().sort((a, b) => a.hop - b.hop));
    }, 350);
    if (storageFlushRef.current) clearInterval(storageFlushRef.current);
    storageFlushRef.current = setInterval(() => {
      if (!storageDirtyRef.current) return;
      storageDirtyRef.current = false;
      setStorageData(storageDataRef.current);
    }, 350);
    if (toolFlushRef.current) clearInterval(toolFlushRef.current);
    toolFlushRef.current = setInterval(() => {
      liveParseTool(); // reparse contínuo de logs seguidos (tail -f / -f / -w)
      if (!toolDirtyRef.current) return;
      toolDirtyRef.current = false;
      setToolData(toolDataRef.current);
    }, 350);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    // ── Helper de config: lê a linha sob o cursor e busca default/descrição ──
    const computeHelp = () => {
      const info = pendingEditorRef.current;
      if (!info) return;
      const buf = term.buffer.active;
      const absY = buf.baseY + buf.cursorY;
      const lineObj = buf.getLine(absY);
      const text = lineObj ? lineObj.translateToString(true) : '';
      const param = extractParam(text, info.type);
      if (param === lastParamRef.current) return;
      lastParamRef.current = param;
      setHelpData(helpFor(param, info.type, { postfix: postfixMapRef.current, sshd: sshdMapRef.current }));
    };
    const readCursorHelp = () => {
      const buf = term.buffer.active;
      const inAlt = buf.type === 'alternate';
      if (inAlt && pendingEditorRef.current) {
        if (!editorActiveRef.current) {
          editorActiveRef.current = true;
          setEditorType(pendingEditorRef.current.type);
          setEditorFile(pendingEditorRef.current.file);
          const key = helperKeyForType(pendingEditorRef.current.type);
          if (key && !helperReqRef.current.has(key) && ws.readyState === WebSocket.OPEN) {
            helperReqRef.current.add(key);
            ws.send(JSON.stringify({ type: 'helper', key }));
          }
        }
        computeHelp();
      } else if (!inAlt && editorActiveRef.current) {
        editorActiveRef.current = false;
        lastParamRef.current = null;
        setEditorType(null); setEditorFile(null); setHelpData(null);
      }
    };
    const handleHelperResult = (key, data) => {
      if (key === 'postfix-defaults') postfixMapRef.current = parsePostconf(data);
      else if (key === 'sshd-effective') sshdMapRef.current = parseSshdT(data);
      lastParamRef.current = null;
      readCursorHelp();
    };
    // Roteia respostas SFTP para o handler registrado pelo sftpApi (por reqId).
    const handleSftpMessage = (msg) => {
      const h = sftpPendingRef.current.get(msg.reqId);
      if (!h) return;
      const done = () => sftpPendingRef.current.delete(msg.reqId);
      switch (msg.type) {
        case 'sftp_error': h.onError?.(msg); done(); break;
        case 'sftp_list_result':
        case 'sftp_ok': h.onResult?.(msg); done(); break;
        case 'sftp_get_meta': h.onMeta?.(msg); break;
        case 'sftp_get_chunk': h.onChunk?.(msg); break;
        case 'sftp_get_eof': h.onEof?.(msg); done(); break;
        case 'sftp_put_ack': h.onAck?.(msg); break;
        case 'sftp_put_done': h.onDone?.(msg); done(); break;
      }
    };

    ws.onopen = () => {
      // Enviar autenticação (com suporte a chave SSH)
      const authPayload = {
        type: 'auth',
        ip: connectionParams?.ip,
        port: connectionParams?.port || 22,
        username: credentials.username,
        password: credentials.password,
      };
      if (credentials.keyPath) authPayload.keyPath = credentials.keyPath;
      if (credentials.passphrase) authPayload.passphrase = credentials.passphrase;
      ws.send(JSON.stringify(authPayload));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case 'output':
            term.write(msg.data);
            onActivity?.();
            sessionLogRef.current += msg.data;
            if (sessionLogRef.current.length > 5000000) sessionLogRef.current = sessionLogRef.current.slice(-4000000);
            feedParser(msg.data);
            break;
          case 'status':
            if (msg.status === 'connected') {
              if (!startedAtRef.current) startedAtRef.current = Date.now();
              onStatusChange?.('connected', msg.message);
              // Enviar tamanho atual do terminal
              const dims = fitAddonRef.current?.proposeDimensions?.();
              if (dims) {
                ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
              }
              // Barra de serviços + stats: coleta inicial + a cada 5s
              const reqSvc = () => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'services' })); };
              reqSvc();
              if (svcTimerRef.current) clearInterval(svcTimerRef.current);
              svcTimerRef.current = setInterval(reqSvc, 5000);
            } else if (msg.status === 'disconnected') {
              onStatusChange?.('disconnected', msg.message);
              term.writeln('');
              term.writeln(`\x1b[33m● ${msg.message || 'Desconectado.'}\x1b[0m`);
            } else if (msg.status === 'connecting') {
              onStatusChange?.('connecting', msg.message);
            }
            break;
          case 'services':
            onServices?.({ list: Array.isArray(msg.list) ? msg.list : [], cpu: msg.cpu ?? null, mem: msg.mem ?? null, users: Array.isArray(msg.users) ? msg.users : [] });
            break;
          case 'helper_result':
            handleHelperResult(msg.key, msg.data);
            break;
          case 'sysinfo':
            try { sysinfoCbRef.current?.(msg.data); } catch {}
            break;
          case 'probe_output':
            feedProbe(msg.id, msg.mode, msg.data || '');
            break;
          case 'probe_done':
            endProbe(msg.id);
            break;
          case 'probe_error':
            endProbe(msg.id);
            term.writeln(`\x1b[33m● sonda (${msg.mode || '?'}) encerrada: ${msg.message || 'erro'}\x1b[0m`);
            break;
          case 'error':
            onStatusChange?.('error', msg.message);
            term.writeln('');
            term.writeln(`\x1b[31m✖ ${msg.message}\x1b[0m`);
            break;
          case 'sftp_list_result':
          case 'sftp_ok':
          case 'sftp_error':
          case 'sftp_get_meta':
          case 'sftp_get_chunk':
          case 'sftp_get_eof':
          case 'sftp_put_ack':
          case 'sftp_put_done':
            handleSftpMessage(msg);
            break;
          case 'http_fetch_result': {
            const h = httpPendingRef.current.get(msg.reqId);
            if (h) { httpPendingRef.current.delete(msg.reqId); h(msg); }
            break;
          }
          case 'bg_exec_result': {
            const h = bgPendingRef.current.get(msg.reqId);
            if (h) { bgPendingRef.current.delete(msg.reqId); h(msg); }
            break;
          }
        }
      } catch {
        // Dados brutos (fallback)
        term.write(event.data);
      }
    };

    ws.onerror = () => {
      onStatusChange?.('error', 'Erro na conexão WebSocket');
      term.writeln('\x1b[31m✖ Erro na conexão WebSocket\x1b[0m');
      term.writeln(`\x1b[90m  tentou: ${wsUrl}\x1b[0m`);
      term.writeln('\x1b[90m  cheque o backend: abra http://localhost:3001/api/health\x1b[0m');
    };

    ws.onclose = () => {
      term.writeln('');
      term.writeln('\x1b[33m● Conexão encerrada.\x1b[0m');
      onStatusChange?.('disconnected');
    };

    // Terminal input → WebSocket (com rastreio da linha p/ o guard + parser)
    const inputDisposable = term.onData((data) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (data === '\r' || data === '\n') {
        const line = inputLineRef.current.trim();
        inputLineRef.current = '';
        if (line) typedCmdRef.current = line; // fallback p/ o parser detectar o comando
        // Guarda PREVENTIVA: comando catastrófico → segura o Enter e confirma no modal.
        if (line && localStorage.getItem('tng_cmd_guard') !== '0') {
          const g = checkGuard(line);
          if (g) { setDangerConfirm({ line, reason: g.reason, hint: g.hint }); return; }
        }
        ws.send(JSON.stringify({ type: 'input', data }));
        onInputRef.current?.(data); // broadcast (espelha para outras abas)
        return;
      }
      if (data === '\x7f' || data === '\b') inputLineRef.current = inputLineRef.current.slice(0, -1);
      else if (data === '\x03' || data === '\x15') inputLineRef.current = '';
      else if (data.length === 1 && data >= ' ') inputLineRef.current += data;
      else if (data.length > 1 && !/[\x00-\x1f]/.test(data)) inputLineRef.current += data; // colar texto simples
      ws.send(JSON.stringify({ type: 'input', data }));
      onInputRef.current?.(data); // broadcast (espelha para outras abas)
    });
    const cursorDisposable = term.onCursorMove(readCursorHelp);

    return () => {
      inputDisposable.dispose();
      cursorDisposable.dispose();
      if (svcTimerRef.current) { clearInterval(svcTimerRef.current); svcTimerRef.current = null; }
      if (parseFlushRef.current) { clearInterval(parseFlushRef.current); parseFlushRef.current = null; }
      if (parseAutoTimerRef.current) { clearTimeout(parseAutoTimerRef.current); parseAutoTimerRef.current = null; }
      if (pingFlushRef.current) { clearInterval(pingFlushRef.current); pingFlushRef.current = null; }
      if (pingAutoTimerRef.current) { clearTimeout(pingAutoTimerRef.current); pingAutoTimerRef.current = null; }
      if (traceFlushRef.current) { clearInterval(traceFlushRef.current); traceFlushRef.current = null; }
      if (traceAutoTimerRef.current) { clearTimeout(traceAutoTimerRef.current); traceAutoTimerRef.current = null; }
      if (storageFlushRef.current) { clearInterval(storageFlushRef.current); storageFlushRef.current = null; }
      if (storageAutoTimerRef.current) { clearTimeout(storageAutoTimerRef.current); storageAutoTimerRef.current = null; }
      if (toolFlushRef.current) { clearInterval(toolFlushRef.current); toolFlushRef.current = null; }
      if (toolAutoTimerRef.current) { clearTimeout(toolAutoTimerRef.current); toolAutoTimerRef.current = null; }
      if (pingRunIdleRef.current) { clearTimeout(pingRunIdleRef.current); pingRunIdleRef.current = null; }
      if (traceRunIdleRef.current) { clearTimeout(traceRunIdleRef.current); traceRunIdleRef.current = null; }
      if (mailTailIdleRef.current) { clearTimeout(mailTailIdleRef.current); mailTailIdleRef.current = null; }
      clearTimeout(idleTimer);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      wsRef.current = null;
    };
  }, [mounted, wsUrl, credentials, connectionParams, onStatusChange, onServices]);

  // ── Resize handler ──
  useEffect(() => {
    if (!mounted || !isVisible) return;

    const handleResize = () => {
      try {
        fitAddonRef.current?.fit();
        const dims = fitAddonRef.current?.proposeDimensions?.();
        if (dims && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
        }
      } catch {}
    };

    // Observar mudanças no container
    const observer = new ResizeObserver(handleResize);
    if (termRef.current) {
      observer.observe(termRef.current);
    }

    return () => observer.disconnect();
  }, [mounted, isVisible]);

  // ── Re-fit quando a janela volta a ser visível (ex: restaurar de minimizado) ──
  useEffect(() => {
    if (isVisible && fitAddonRef.current) {
      // Múltiplos fits em cascata para garantir que o DOM está pronto
      // após display:none → display:contents transition
      const t1 = setTimeout(() => { try { fitAddonRef.current?.fit(); termInstanceRef.current?.focus(); } catch {} }, 50);
      const t2 = setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
          // Informar servidor sobre novo tamanho
          const dims = fitAddonRef.current?.proposeDimensions?.();
          if (dims && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
          }
          // Garantir que o terminal ativo recebe o teclado (evita "travar"
          // quando outra aba abre e rouba o foco do textarea do xterm).
          termInstanceRef.current?.focus();
        } catch {}
      }, 200);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    } else if (!isVisible) {
      // Ao esconder a aba, tira o foco para não capturar teclas em background.
      try { termInstanceRef.current?.blur(); } catch {}
    }
  }, [isVisible]);

  // ── Apply font/appearance settings live (no reconnect needed) ──
  const applyTermAppearance = () => {
    const t = termInstanceRef.current;
    if (!t) return;
    try {
      if (S.fontFamily) t.options.fontFamily = S.fontFamily;
      if (S.fontSize) t.options.fontSize = S.fontSize;
      if (S.lineHeight) t.options.lineHeight = S.lineHeight;
      const ec = effColors();
      t.options.theme = { ...t.options.theme, background: ec.background, foreground: ec.foreground, cursor: ec.cursor, cursorAccent: ec.background };
      setBgColor(ec.background);
      fitAddonRef.current?.fit();
      const dims = fitAddonRef.current?.proposeDimensions?.();
      if (dims && wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
    } catch {}
  };
  useEffect(() => { applyTermAppearance(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [S.fontFamily, S.fontSize, S.lineHeight, S.background, S.foreground, S.cursor]);
  // Re-tint the terminal whenever the global theme changes.
  useEffect(() => {
    const onTheme = () => { setBlackMode(isBlackBg()); setFloatOverlays(isFloatOverlays()); applyTermAppearance(); };
    window.addEventListener('tng:theme', onTheme);
    return () => window.removeEventListener('tng:theme', onTheme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── API imperativa exposta ao FloatingWindow (sidebar scripts/logs) ──
  useImperativeHandle(ref, () => ({
    runScript: (code) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      const text = String(code || '');
      const payload = text.endsWith('\n') ? text : text + '\n';
      ws.send(JSON.stringify({ type: 'input', data: payload }));
      return true;
    },
    isConnected: () => wsRef.current?.readyState === WebSocket.OPEN,
    // Injeta input recebido de outra aba (broadcast) direto no PTY — não passa
    // por term.onData, então NÃO re-dispara o broadcast (sem loop).
    sendInput: (data) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify({ type: 'input', data: String(data) }));
      return true;
    },
    requestSysinfo: (cb) => {
      const ws = wsRef.current;
      sysinfoCbRef.current = cb;
      if (!ws || ws.readyState !== WebSocket.OPEN) { cb?.(null); return false; }
      ws.send(JSON.stringify({ type: 'sysinfo' }));
      return true;
    },
    getSessionLog: () => ({ content: stripAnsi(sessionLogRef.current), startedAt: startedAtRef.current }),
    sshFetch: (url) => sshFetch(url),
    focus: () => { try { fitAddonRef.current?.fit(); termInstanceRef.current?.focus(); } catch {} },
  }), []);

  const parseVisible = parseOn || autoOn || parsePinned;
  const enableParse = () => { suppressAutoRef.current = false; parseOnRef.current = true; setParseOn(true); };
  const disableParse = () => { stopManualTail(); suppressAutoRef.current = true; parseOnRef.current = false; setParseOn(false); setAutoOn(false); setParsePinned(false); };
  const clearMail = () => { parseCountsRef.current = {}; setMailEvents([]); setMailCounts({}); };
  // Block a source address from the mail parser: firewall (iptables) with a
  // null-route (blackhole) fallback. ip is regex-extracted so it's injection-safe.
  const blockAddress = (ip) => {
    if (!ip || !/^[0-9a-fA-F:.]+$/.test(ip)) return;
    if (!window.confirm(`Bloquear o endereço ${ip}?\n\nTenta o firewall (iptables) e, se indisponível, adiciona uma rota nula (blackhole). Requer sudo.`)) return;
    const cmd = `sudo sh -c 'iptables -I INPUT -s ${ip} -j DROP 2>/dev/null && echo "[TNG] ${ip} bloqueado via firewall (iptables)" || { ip route add blackhole ${ip} && echo "[TNG] ${ip} bloqueado via rota nula"; }'`;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data: cmd + '\n' }));
  };

  // Envia uma mensagem de sonda (probe) ao backend, que roda o comando num
  // canal SSH PARALELO e devolve só a saída — o terminal não é tocado.
  const sendProbe = (obj) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(obj));
    return true;
  };
  const nextProbeId = (mode) => `${mode}-${Date.now()}-${++probeSeqRef.current}`;
  // Acompanha um arquivo de log via tail -f numa conexão paralela. Caminho
  // validado (sem espaços/metacaracteres) — o backend revalida por segurança.
  const runManualTail = (file) => {
    const f = String(file || '').trim();
    if (!f || !/^[A-Za-z0-9._/-]+$/.test(f)) return;
    if (mailProbeRef.current) sendProbe({ type: 'probe_stop', id: mailProbeRef.current });
    const id = nextProbeId('tail');
    mailProbeRef.current = id;
    setMailManual(true); setMailTailRunning(true);
    enableParse();
    if (!sendProbe({ type: 'probe_start', id, mode: 'tail', target: f })) {
      mailProbeRef.current = null; setMailManual(false); setMailTailRunning(false);
    }
  };
  const stopManualTail = () => {
    const id = mailProbeRef.current;
    if (id) sendProbe({ type: 'probe_stop', id });
    mailProbeRef.current = null; setMailManual(false); setMailTailRunning(false);
  };

  // Auto do ping/trace é mutuamente exclusivo via activeProbe: enquanto um
  // comando ping está em foco, o auto do traceroute não aparece (e vice-versa).
  // O modo explícito (botão/fixado) sempre vale.
  const pingVisible = pingOn || pingPinned || (pingAuto && activeProbe !== 'trace');
  const enablePing = () => { pingSuppressRef.current = false; pingOnRef.current = true; setPingOn(true); };
  const disablePing = () => { stopManualPing(); pingSuppressRef.current = true; pingOnRef.current = false; setPingOn(false); setPingAuto(false); setPingPinned(false); };
  const clearPing = () => { pingPendingRef.current = []; pingStateRef.current = null; setPingSamples([]); };
  // Dispara o ping numa conexão SSH paralela (backend), deixando o terminal
  // livre. Host validado p/ evitar injeção; o backend revalida.
  const runManualPing = (host) => {
    const h = String(host || '').trim();
    if (!h || !/^[A-Za-z0-9][A-Za-z0-9.:_-]*$/.test(h)) return;
    stopManualTrace(); // ping e trace dividem o painel — uma sonda de rede por vez
    if (pingProbeRef.current) sendProbe({ type: 'probe_stop', id: pingProbeRef.current });
    const id = nextProbeId('ping');
    pingProbeRef.current = id;
    setPingManual(true); setPingRunning(true);
    activeProbeRef.current = 'ping'; setActiveProbe('ping');
    enablePing(); clearPing();
    if (!sendProbe({ type: 'probe_start', id, mode: 'ping', target: h })) {
      pingProbeRef.current = null; setPingManual(false); setPingRunning(false);
    }
  };
  const stopManualPing = () => {
    const id = pingProbeRef.current;
    if (id) sendProbe({ type: 'probe_stop', id });
    pingProbeRef.current = null; setPingManual(false); setPingRunning(false);
  };

  const traceVisible = traceOn || tracePinned || (traceAuto && activeProbe !== 'ping');
  const enableTrace = () => { traceOnRef.current = true; setTraceOn(true); };
  const disableTrace = () => { stopManualTrace(); traceOnRef.current = false; setTraceOn(false); setTraceAuto(false); setTracePinned(false); };
  const clearTrace = () => { traceHopsRef.current = []; traceDestRef.current = null; setTraceHops([]); setTraceDest(null); };
  const runManualTrace = (host) => {
    const h = String(host || '').trim();
    if (!h || !/^[A-Za-z0-9][A-Za-z0-9.:_-]*$/.test(h)) return;
    stopManualPing();
    if (traceProbeRef.current) sendProbe({ type: 'probe_stop', id: traceProbeRef.current });
    const id = nextProbeId('trace');
    traceProbeRef.current = id;
    setTraceManual(true); setTraceRunning(true);
    activeProbeRef.current = 'trace'; setActiveProbe('trace');
    enableTrace(); clearTrace();
    if (!sendProbe({ type: 'probe_start', id, mode: 'trace', target: h })) {
      traceProbeRef.current = null; setTraceManual(false); setTraceRunning(false);
    }
  };
  const stopManualTrace = () => {
    const id = traceProbeRef.current;
    if (id) sendProbe({ type: 'probe_stop', id });
    traceProbeRef.current = null; setTraceManual(false); setTraceRunning(false);
  };

  const storageVisible = storageOn || storageAuto || storagePinned;
  const enableStorage = () => { storageOnRef.current = true; setStorageOn(true); };
  const disableStorage = () => { storageOnRef.current = false; setStorageOn(false); setStorageAuto(false); setStoragePinned(false); };
  const clearStorage = () => { storageDataRef.current = null; setStorageData(null); };

  const toolVisible = toolOn || toolAuto || toolPinned;
  const enableTool = () => { toolOnRef.current = true; setToolOn(true); };
  const disableTool = () => { toolOnRef.current = false; setToolOn(false); setToolAuto(false); setToolPinned(false); };
  const clearTool = () => { toolDataRef.current = null; setToolData(null); };
  // Exec em segundo plano (canal SSH separado) — não polui o terminal.
  const runBgExec = (command) => new Promise((resolve, reject) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error('Sem conexão SSH ativa.'));
    const reqId = `bg-${Date.now()}-${++sftpSeqRef.current}`;
    bgPendingRef.current.set(reqId, (m) => (m.ok ? resolve(m) : reject(new Error(m.error || 'falha'))));
    ws.send(JSON.stringify({ type: 'bg_exec', reqId, command }));
    setTimeout(() => { if (bgPendingRef.current.has(reqId)) { bgPendingRef.current.delete(reqId); reject(new Error('tempo esgotado')); } }, 30000);
  });
  // Health check: roda a bateria de comandos EM SEGUNDO PLANO (canal separado)
  // e mostra o resultado agregado no painel — o terminal fica livre.
  const showTool = (data) => { if (!data) return; toolDataRef.current = data; setToolData(data); if (!toolOnRef.current) setToolAuto(true); };
  const runHealthCheck = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    enableTool();
    showTool({ title: 'Health check', icon: 'gauge', sections: [{ type: 'note', tone: 'info', title: 'Coletando…', text: 'Rodando os checks em segundo plano — o terminal continua livre.' }] });
    runBgExec(HEALTH_COMMAND)
      .then((m) => { const parsed = parseTool('health', m.output || ''); showTool(parsed || { title: 'Health check', icon: 'gauge', sections: [{ type: 'note', tone: 'warn', title: 'Sem dados', text: 'Não consegui coletar (o host tem uptime/free/df/ps?).' }] }); })
      .catch((e) => showTool({ title: 'Health check', icon: 'alert', sections: [{ type: 'note', tone: 'danger', title: 'Falha', text: e.message }] }));
  };

  const closeHelper = () => {
    editorActiveRef.current = false; pendingEditorRef.current = null; lastParamRef.current = null;
    setEditorType(null); setEditorFile(null); setHelpData(null);
  };

  // ── Parser IA: pede ao backend uma avaliação da última captura e injeta um
  //    bloco "Análise IA" no topo do painel (narrativa + achados + sugestões).
  const SEV_TONE = { ok: 'ok', info: 'info', warn: 'warn', crit: 'danger' };
  const analyzeWithAI = async () => {
    const cap = lastCaptureRef.current;
    if (!cap || !cap.command) return;
    aiAnalyzedIdRef.current = cap.id;
    setAiBusy(true);
    try {
      const r = await api.post('/ai/insight', { command: cap.command, output: String(cap.output || '').slice(-6000) });
      const ins = r && r.insight;
      if (ins) {
        const tone = SEV_TONE[ins.severity] || 'info';
        const aiSecs = [{ _ai: true, type: 'note', tone, title: `🧠 Análise IA${ins.summary ? ' — ' + ins.summary : ''}`, text: (ins.findings || []).join(' · ') || (r.mode === 'offline-heuristic' ? '(modo offline — configure a IA p/ análise completa)' : '') }];
        if (ins.suggestions && ins.suggestions.length) aiSecs.push({ _ai: true, type: 'kv', items: ins.suggestions.map((s) => ({ k: s.cmd, v: s.why || '', tone: 'accent' })) });
        const cur = toolDataRef.current || { title: 'Análise IA', icon: 'cpu', sections: [] };
        const base = (cur.sections || []).filter((s) => !s._ai);
        const merged = { ...cur, sections: [...aiSecs, ...base] };
        toolDataRef.current = merged; setToolData(merged);
        if (!toolOnRef.current) { setToolAuto(true); }
      }
    } catch {}
    setAiBusy(false);
  };
  // Parser IA agora é SOB DEMANDA: a IA só analisa quando o usuário clica no
  // botão ✨ do painel — nunca automaticamente a cada comando. (Sem "lixo".)

  // ── SFTP: API promissora exposta ao FileBrowser (transferências scp/ftp-like) ──
  const SFTP_UP_CHUNK = 64 * 1024;
  const u8ToB64 = (u8) => { let s = ''; const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); };
  const b64ToU8 = (b64) => { const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; };
  const triggerDownload = (blob, name) => { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name || 'download'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); };
  const sftpSend = (obj) => { const ws = wsRef.current; if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(obj)); return true; } return false; };
  const nextSftpReq = () => `sf-${Date.now()}-${++sftpSeqRef.current}`;
  const sftpRequest = (payload) => new Promise((resolve, reject) => {
    const reqId = nextSftpReq();
    sftpPendingRef.current.set(reqId, { onResult: (m) => resolve(m), onError: (m) => reject(new Error(m.message || 'erro SFTP')) });
    if (!sftpSend({ ...payload, reqId })) { sftpPendingRef.current.delete(reqId); reject(new Error('Sem conexão SSH ativa.')); }
  });
  // useMemo: identidade estável entre renders — se recriado a cada render, o
  // FileBrowser detecta "api mudou" e reseta a navegação para o diretório home.
  const sftpApi = useMemo(() => ({
    connected: () => wsRef.current?.readyState === WebSocket.OPEN,
    realpath: (p) => sftpRequest({ type: 'sftp_realpath', path: p }).then((m) => m.path),
    list: (p) => sftpRequest({ type: 'sftp_list', path: p }).then((m) => ({ path: m.path, entries: m.entries || [] })),
    mkdir: (p) => sftpRequest({ type: 'sftp_mkdir', path: p }),
    rename: (from, to) => sftpRequest({ type: 'sftp_rename', from, to }),
    chmod: (p, mode) => sftpRequest({ type: 'sftp_chmod', path: p, mode }),
    remove: (p, opts = {}) => sftpRequest({ type: 'sftp_delete', path: p, isDir: !!opts.isDir, recursive: !!opts.recursive }),
    download: (p, opts = {}) => new Promise((resolve, reject) => {
      const reqId = nextSftpReq(); const parts = []; let size = 0; let received = 0;
      sftpPendingRef.current.set(reqId, {
        onMeta: (m) => { size = m.size || 0; },
        onChunk: (m) => { const u8 = b64ToU8(m.data); parts.push(u8); received += u8.length; opts.onProgress?.(received, size); sftpSend({ type: 'sftp_get_ack', reqId, seq: m.seq }); },
        onEof: () => { const blob = new Blob(parts); if (opts.asBlob) resolve({ blob, size: received }); else { triggerDownload(blob, basename(p)); resolve({ size: received }); } },
        onError: (m) => reject(new Error(m.message || 'erro no download')),
      });
      if (!sftpSend({ type: 'sftp_get', reqId, path: p })) { sftpPendingRef.current.delete(reqId); reject(new Error('Sem conexão SSH ativa.')); }
    }),
    upload: (file, destPath, opts = {}) => new Promise((resolve, reject) => {
      const reqId = nextSftpReq(); const size = file.size; let offset = 0;
      const sendNext = async () => {
        if (offset >= size) { sftpSend({ type: 'sftp_put_end', reqId }); return; }
        const slice = file.slice(offset, offset + SFTP_UP_CHUNK);
        let buf; try { buf = new Uint8Array(await slice.arrayBuffer()); } catch (e) { sftpPendingRef.current.delete(reqId); reject(e); return; }
        const seq = Math.floor(offset / SFTP_UP_CHUNK) + 1; offset += buf.length;
        sftpSend({ type: 'sftp_put_chunk', reqId, seq, data: u8ToB64(buf) });
      };
      sftpPendingRef.current.set(reqId, {
        onAck: () => { opts.onProgress?.(Math.min(offset, size), size); sendNext(); },
        onDone: (m) => { opts.onProgress?.(size, size); resolve({ written: m.written }); },
        onError: (m) => reject(new Error(m.message || 'erro no upload')),
      });
      if (!sftpSend({ type: 'sftp_put_start', reqId, path: destPath, size })) { sftpPendingRef.current.delete(reqId); reject(new Error('Sem conexão SSH ativa.')); }
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
  const openFiles = () => { if (wsRef.current?.readyState === WebSocket.OPEN) setFilesOpen(true); };
  // Busca uma URL DE DENTRO do host remoto (curl no servidor SSH). Promise → { ok, status, contentType, bodyB64 }.
  const sshFetch = (url) => new Promise((resolve, reject) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error('Sem conexão SSH ativa nesta sessão.'));
    const reqId = `hf-${Date.now()}-${++sftpSeqRef.current}`;
    httpPendingRef.current.set(reqId, (m) => (m.ok ? resolve(m) : reject(new Error(m.error || 'falha ao buscar via SSH'))));
    ws.send(JSON.stringify({ type: 'http_fetch', reqId, url }));
    setTimeout(() => { if (httpPendingRef.current.has(reqId)) { httpPendingRef.current.delete(reqId); reject(new Error('tempo esgotado')); } }, 30000);
  });
  // Abre um arquivo (link do parser de `ls`) no editor compartilhado. Expande ~
  // para o home real (uma vez) e abre transparente — sem vi/nano.
  const openRemoteFile = async (rawPath) => {
    let p = String(rawPath || '');
    if (!p) return;
    if (p.startsWith('~')) {
      if (!homeRef.current) { try { homeRef.current = await sftpApi.realpath('.'); } catch {} }
      if (homeRef.current) p = homeRef.current.replace(/\/$/, '') + p.slice(1);
    }
    setEditPath(p);
  };
  openFileRef.current = openRemoteFile; // o link provider do xterm chama a versão atual

  // Guarda de comando: confirma (envia Enter) ou cancela (Ctrl-C limpa a linha).
  const confirmDanger = () => { const ws = wsRef.current; if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data: '\r' })); setDangerConfirm(null); try { termInstanceRef.current?.focus(); } catch {} };
  const cancelDanger = () => { const ws = wsRef.current; if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data: '\x03' })); setDangerConfirm(null); try { termInstanceRef.current?.focus(); } catch {} };

  return (
    <div className="relative w-full h-full" style={{ background: bgColor }}
      onMouseDown={() => { try { termInstanceRef.current?.focus(); } catch {} }}>
      <div ref={termRef} className="w-full h-full" style={{ padding: '4px' }} />
      <RootModeFX active={rootActive} dustOnly={blackMode} />

      {!parseVisible && !pingVisible && !traceVisible && !storageVisible && !toolVisible && (
        toolbarHidden ? (
          <button onClick={toggleToolbar} title="Mostrar botões de parse (Ping/Trace/Disk/Mail/Diag)"
            className="absolute top-2 right-2 z-30 p-1.5 rounded-lg border border-theme bg-black/60 text-theme-soft hover:bg-theme-soft transition-colors">
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </button>
        ) : (
          <div className="absolute top-2 right-2 z-30 flex items-center gap-1.5">
            <button onClick={enablePing} title="Estatisticas e grafico de ping (RTT, perdas, qualidade)"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-theme bg-black/60 text-[11px] text-theme hover:bg-theme-soft transition-colors">
              <Activity className="w-3.5 h-3.5" /> Ping
            </button>
            <button onClick={enableTrace} title="Visualizar saltos do traceroute"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-theme bg-black/60 text-[11px] text-theme hover:bg-theme-soft transition-colors">
              <Route className="w-3.5 h-3.5" /> Trace
            </button>
            <button onClick={enableStorage} title="Visualizar discos/filesystems/LVM (df, lsblk, fdisk, pvs/vgs/lvs)"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-theme bg-black/60 text-[11px] text-theme hover:bg-theme-soft transition-colors">
              <HardDrive className="w-3.5 h-3.5" /> Disk
            </button>
            <button onClick={enableParse} title="Formatar log de email (Postfix) para leitura"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-theme bg-black/60 text-[11px] text-theme hover:bg-theme-soft transition-colors">
              <Mail className="w-3.5 h-3.5" /> Mail
            </button>
            <button onClick={enableTool} title="Diagnóstico: ss, ip, ps, free, iostat, journalctl, dmesg, auth/web logs, systemctl, smartctl…"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-theme bg-black/60 text-[11px] text-theme hover:bg-theme-soft transition-colors">
              <Wrench className="w-3.5 h-3.5" /> Diag
            </button>
            <button onClick={runHealthCheck} title="Health check: roda uma bateria de comandos somente-leitura e mostra um resumo da saúde do servidor"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-theme bg-black/60 text-[11px] text-theme hover:bg-theme-soft transition-colors">
              <HeartPulse className="w-3.5 h-3.5" /> Saúde
            </button>
            <button onClick={openFiles} title="Arquivos (SFTP): navegar, enviar e baixar arquivos entre o servidor e sua máquina"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-theme bg-black/60 text-[11px] text-theme hover:bg-theme-soft transition-colors">
              <FolderTree className="w-3.5 h-3.5" /> Arquivos
            </button>
            <button onClick={toggleToolbar} title="Esconder botões de parse"
              className="p-1.5 rounded-lg border border-theme bg-black/60 text-theme-soft hover:bg-theme-soft transition-colors">
              <EyeOff className="w-3.5 h-3.5" />
            </button>
          </div>
        )
      )}

      <AnimatePresence>
        {storageVisible && (
          <StorageOverlay data={storageData} auto={storageAuto && !storageOn}
            pinned={storagePinned} onTogglePin={() => setStoragePinned((v) => !v)}
            onClose={disableStorage} onClear={clearStorage} floating={floatOverlays} sessionLabel={sessionLabel} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toolVisible && !storageVisible && (
          <ToolParseOverlay data={toolData} auto={toolAuto && !toolOn}
            pinned={toolPinned} onTogglePin={() => setToolPinned((v) => !v)}
            aiBusy={aiBusy} onAnalyzeAi={analyzeWithAI}
            onOpenFile={openRemoteFile}
            onClose={disableTool} onClear={clearTool} floating={floatOverlays} sessionLabel={sessionLabel} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pingVisible && (
          <PingParseOverlay samples={pingSamples} auto={pingAuto && !pingOn}
            pinned={pingPinned} onTogglePin={() => setPingPinned(v => !v)}
            onRun={runManualPing} onStop={stopManualPing} running={pingRunning} stoppable={pingManual}
            onClose={disablePing} onClear={clearPing} floating={floatOverlays} sessionLabel={sessionLabel} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {traceVisible && !pingVisible && (
          <TraceParseOverlay dest={traceDest} hops={traceHops} auto={traceAuto && !traceOn}
            pinned={tracePinned} onTogglePin={() => setTracePinned(v => !v)}
            onRun={runManualTrace} onStop={stopManualTrace} running={traceRunning} stoppable={traceManual}
            onClose={disableTrace} onClear={clearTrace} floating={floatOverlays} sessionLabel={sessionLabel} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {parseVisible && !pingVisible && !traceVisible && (
          <MailParseOverlay events={mailEvents} counts={mailCounts} auto={autoOn && !parseOn}
            pinned={parsePinned} onTogglePin={() => setParsePinned(v => !v)}
            onRunTail={runManualTail} onStopTail={stopManualTail} running={mailTailRunning} stoppable={mailManual} defaultFile="/var/log/mail.log"
            onClose={disableParse} onClear={clearMail} onBlock={blockAddress} floating={floatOverlays} sessionLabel={sessionLabel} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editorType && (
          <ConfigHelperOverlay type={editorType} fileName={editorFile} help={helpData} onClose={closeHelper} floating={floatOverlays} sessionLabel={sessionLabel} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {filesOpen && (
          <FileBrowser api={sftpApi} sessionLabel={sessionLabel} onClose={() => setFilesOpen(false)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editPath && (
          <FileEditor api={sftpApi} path={editPath} onClose={() => setEditPath(null)} onSaved={() => {}} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {dangerConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[10020] grid place-items-center p-4" style={{ background: 'rgba(2,3,8,0.8)', backdropFilter: 'blur(4px)' }}>
            <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md rounded-xl overflow-hidden" style={{ background: 'var(--bg-2)', border: '1px solid var(--cyber-danger)', boxShadow: '0 0 40px color-mix(in srgb, var(--cyber-danger) 30%, transparent)' }}>
              <div className="px-4 py-3 flex items-center gap-2" style={{ background: 'color-mix(in srgb, var(--cyber-danger) 16%, transparent)' }}>
                <span style={{ color: 'var(--cyber-danger)', fontSize: 18 }}>⚠</span>
                <span className="font-display tracking-cyber" style={{ color: 'var(--cyber-danger)' }}>Comando perigoso</span>
              </div>
              <div className="p-4 space-y-2.5">
                <div className="font-mono text-[13px] px-3 py-2 rounded" style={{ background: 'rgba(0,0,0,0.4)', color: 'var(--text)', wordBreak: 'break-all' }}>$ {dangerConfirm.line}</div>
                <div className="text-[12px]" style={{ color: 'var(--cyber-danger)' }}>{dangerConfirm.reason}</div>
                <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>{dangerConfirm.hint}</div>
                <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>Tem certeza que deseja executar?</div>
              </div>
              <div className="flex justify-end gap-2 px-4 pb-4">
                <button onClick={cancelDanger} className="px-3 py-1.5 rounded-lg text-[12px]" style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--text)' }}>Cancelar</button>
                <button onClick={confirmDanger} className="px-3 py-1.5 rounded-lg text-[12px] font-semibold" style={{ background: 'var(--cyber-danger)', color: '#fff' }}>Executar mesmo assim</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

XTerminal.displayName = 'XTerminal';

export default XTerminal;
