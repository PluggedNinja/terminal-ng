/**
 * ConfigHelperOverlay.jsx
 * Helper (não intrusivo) exibido quando o usuário edita um arquivo de config
 * conhecido (postfix/sshd/apache). Mostra, para o parâmetro sob o cursor:
 * descrição curta + valor default (Postfix ao vivo via postconf -d) e, quando
 * disponível, o valor efetivo atual (sshd -T).
 */
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, X, Sparkles, Loader2 } from 'lucide-react';
import { typeLabel } from '../../utils/configHelp';
import { api } from '../../lib/api';
import { useOverlayCard, CardControls } from './overlayCard';

// Short documentation per config type — what this helper assists with.
const HELP_DOCS = {
  postfix: 'Servidor de e-mail (MTA). Mostra default (postconf -d) e o valor efetivo do parâmetro sob o cursor. Cuidado com myhostname, mynetworks, relayhost e restrictions.',
  sshd: 'Servidor SSH. Valor efetivo via sshd -T. Endureça com PermitRootLogin, PasswordAuthentication, Port, AllowUsers e Ciphers/MACs modernos.',
  apache: 'Servidor web Apache. Diretivas de VirtualHost, módulos, timeouts e segurança (ServerTokens, TraceEnable, headers).',
  nginx: 'Servidor web/proxy Nginx. Blocos server/location, proxy_pass, headers, gzip, limites e TLS (ssl_protocols, ciphers).',
  sysctl: 'Parâmetros do kernel (/etc/sysctl.conf). Rede, memória e segurança. Aplique com sysctl -p.',
  php: 'Configuração do PHP (php.ini). memory_limit, upload_max_filesize, max_execution_time, expose_php, error_reporting.',
  mysql: 'Banco MySQL/MariaDB (my.cnf). buffers (innodb_buffer_pool_size), conexões, binlog e tuning de performance.',
  redis: 'Cache/armazenamento Redis. maxmemory, política de eviction, persistência (RDB/AOF) e bind/requirepass.',
  grub: 'Bootloader GRUB. Parâmetros de boot do kernel, timeout e ordem. Rode update-grub após alterar.',
  systemd: 'Unidades systemd (.service). ExecStart, Restart, limites e dependências (After/Requires).',
};

const ConfigHelperOverlay = ({ type, fileName, help, onClose, floating, sessionLabel }) => {
  const doc = HELP_DOCS[type];

  // ── Helper IA: avalia a diretiva sob o cursor com a IA (boas práticas/segurança) ──
  const [aiOn, setAiOn] = useState(() => { try { return localStorage.getItem('tng_ai_helper') === '1'; } catch { return false; } });
  const [aiText, setAiText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const aiReqRef = useRef('');
  const toggleAi = () => setAiOn((v) => { const n = !v; try { localStorage.setItem('tng_ai_helper', n ? '1' : '0'); } catch {} return n; });

  useEffect(() => {
    if (!aiOn || !help || !help.param) { setAiText(''); return; }
    const key = `${type}:${help.param}`;
    if (aiReqRef.current === key) return;
    aiReqRef.current = key;
    setAiText(''); setAiBusy(true);
    const prompt = `Config de ${typeLabel(type)}${fileName ? ` (${fileName})` : ''}. Explique a diretiva "${help.param}" (default: ${help.default}${help.current != null ? `, valor atual: ${help.current}` : ''}) em 2-3 frases curtas, focando uso prático e segurança/boas práticas. Responda em português.`;
    const t = setTimeout(() => {
      api.post('/ai/ask', { prompt, context: '' })
        .then((r) => { if (aiReqRef.current === key) setAiText(String(r?.answer || '').slice(0, 600)); })
        .catch(() => {})
        .finally(() => { if (aiReqRef.current === key) setAiBusy(false); });
    }, 450); // debounce ao navegar entre parâmetros
    return () => clearTimeout(t);
  }, [aiOn, type, fileName, help && help.param]);

  const card = useOverlayCard(floating);
  const isFloat = card.floating;

  const body = (
    <motion.div ref={card.rootRef} {...card.dragProps}
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 30 }}
      className={`${isFloat ? 'fixed top-3 right-3 bottom-3 z-[9997]' : 'absolute top-2 right-2 bottom-2 z-30'} flex flex-col rounded-xl overflow-hidden shadow-2xl backdrop-blur-sm`}
      style={{ width: isFloat ? 360 : 'min(360px, 48%)', background: 'color-mix(in srgb, var(--bg-2) 96%, transparent)', border: '1px solid color-mix(in srgb, var(--cyber-secondary) 30%, transparent)', ...card.resizeStyle }}
    >
      <div className="flex items-center justify-between px-3 py-1.5 shrink-0" style={{ borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />
          <span className="text-[10px] font-bold text-violet-300">{typeLabel(type)}</span>
          {isFloat && sessionLabel && <span className="text-[9px] px-1 rounded" style={{ background: 'color-mix(in srgb, var(--cyber-secondary) 16%, transparent)', color: 'var(--cyber-secondary)' }}>{sessionLabel}</span>}
          {fileName && <span className="text-[9px] text-slate-500 truncate">· {fileName}</span>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <CardControls card={card} />
          <button onClick={toggleAi} title={aiOn ? 'Helper IA ligado — a IA avalia a diretiva sob o cursor. Clique para desligar.' : 'Avaliar a diretiva com IA (boas práticas/segurança)'}
            className="px-1.5 py-0.5 rounded flex items-center gap-1 text-[9px]"
            style={{ color: aiOn ? 'var(--cyber-accent)' : 'var(--text-dim)', background: aiOn ? 'color-mix(in srgb, var(--cyber-accent) 14%, transparent)' : 'transparent' }}>
            {aiBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} IA
          </button>
          <button onClick={onClose} title="Fechar helper" className="p-0.5 rounded hover:bg-red-500/20 text-slate-400">
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
      {doc && <p className="px-3 pt-1.5 text-[9px] leading-snug" style={{ color: 'var(--text-dim)' }}>{doc}</p>}

      <div className="px-3 py-2 min-h-[52px]">
        <AnimatePresence mode="wait">
          {help ? (
            <motion.div key={help.param} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-[12px] font-mono font-bold text-white">{help.param}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded font-mono" style={{ background: 'rgba(139,92,246,0.15)', color: '#c4b5fd' }}>
                  default: {String(help.default)}
                </span>
                {help.current !== undefined && help.current !== null && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-mono" style={{ background: 'rgba(34,197,94,0.15)', color: '#86efac' }}>
                    atual: {String(help.current)}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-300 mt-1 leading-snug">{help.desc}</p>
              {help.ex && (
                <div className="mt-1.5">
                  <div className="text-[8px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>exemplo</div>
                  <code className="block text-[10px] font-mono mt-0.5 px-2 py-1 rounded" style={{ background: 'rgba(0,0,0,0.4)', color: 'var(--cyber-accent)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{help.ex}</code>
                </div>
              )}
              {help.source && <p className="text-[8px] text-slate-600 mt-1">fonte: {help.source}</p>}
              {aiOn && (aiBusy || aiText) && (
                <div className="mt-2 pt-2" style={{ borderTop: '1px solid rgba(148,163,184,0.15)' }}>
                  <div className="flex items-center gap-1 text-[9px] font-bold" style={{ color: 'var(--cyber-accent)' }}>
                    {aiBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Análise IA
                  </div>
                  {aiText && <p className="text-[10px] text-slate-300 mt-1 leading-snug">{aiText}</p>}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.p key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="text-[10px] text-slate-500 italic">
              Posicione o cursor na linha de um parâmetro para ver default e descrição.
            </motion.p>
          )}
        </AnimatePresence>
      </div>
      </div>
    </motion.div>
  );
  return isFloat ? createPortal(body, document.body) : body;
};

export default ConfigHelperOverlay;
