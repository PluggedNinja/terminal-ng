import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Workflow, Plus, Trash2, Play, Save, X, Terminal, Clock, ChevronUp, ChevronDown,
  Bot, FlaskConical, CheckCircle2, AlertTriangle, Loader2, Power, FileText, Square,
} from 'lucide-react';
import { getFlows, createFlow, saveFlow, deleteFlow, runFlow, getFlowRuns, getHostsList } from '../lib/api.js';
import { sfx } from '../lib/sound.js';

const uid = () => 's_' + Math.random().toString(36).slice(2, 8);
const STEP_META = {
  command: { label: 'Comando', Icon: Terminal, color: 'var(--cyber-primary)' },
  test: { label: 'Teste / Validação', Icon: FlaskConical, color: 'var(--cyber-warn)' },
  ai: { label: 'Decisão IA', Icon: Bot, color: 'var(--cyber-secondary)' },
};
const OPS = [['contains', 'contém'], ['not_contains', 'não contém'], ['equals', 'igual a'], ['regex', 'regex'], ['exit_zero', 'exit code = 0'], ['exit_nonzero', 'exit code ≠ 0']];
const newStep = (type) => type === 'command' ? { id: uid(), type, name: '', cmd: '', timeout: 30 }
  : type === 'test' ? { id: uid(), type, name: '', cmd: '', op: 'contains', value: '', onFail: 'stop' }
  : { id: uid(), type: 'ai', name: '', prompt: '', onNo: 'stop' };

const statusColor = (s) => s === 'ok' ? 'var(--cyber-accent)' : s === 'failed' ? 'var(--cyber-warn)' : s === 'running' ? 'var(--cyber-primary)' : 'var(--cyber-danger)';

export default function FlowBuilder({ onClose }) {
  const [flows, setFlows] = useState([]);
  const [hosts, setHosts] = useState([]);
  const [sel, setSel] = useState(null);     // selected flow id
  const [draft, setDraft] = useState(null); // editable copy
  const [runs, setRuns] = useState([]);
  const [openRun, setOpenRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const [runningNow, setRunningNow] = useState(false);

  const refresh = useCallback(async () => { setFlows(await getFlows()); }, []);
  useEffect(() => { refresh(); getHostsList().then(setHosts); }, [refresh]);

  const select = async (f) => { sfx.click(); setSel(f.id); setDraft(JSON.parse(JSON.stringify(f))); setRuns(await getFlowRuns(f.id)); setOpenRun(null); };
  const addNew = async () => {
    sfx.click();
    const f = await createFlow({ name: 'Novo fluxo', schedule: { kind: 'manual' }, steps: [newStep('command')] });
    await refresh(); select(f);
  };
  const patch = (p) => setDraft((d) => ({ ...d, ...p }));
  const patchStep = (id, p) => setDraft((d) => ({ ...d, steps: d.steps.map((s) => (s.id === id ? { ...s, ...p } : s)) }));
  const addStep = (type) => { sfx.toggle(); setDraft((d) => ({ ...d, steps: [...d.steps, newStep(type)] })); };
  const removeStep = (id) => setDraft((d) => ({ ...d, steps: d.steps.filter((s) => s.id !== id) }));
  const moveStep = (i, dir) => setDraft((d) => { const a = [...d.steps]; const j = i + dir; if (j < 0 || j >= a.length) return d; [a[i], a[j]] = [a[j], a[i]]; return { ...d, steps: a }; });

  const save = async () => { if (!draft) return; setBusy(true); sfx.success(); try { await saveFlow(draft.id, draft); await refresh(); } finally { setBusy(false); } };
  const remove = async () => { if (!draft || !window.confirm('Apagar este fluxo?')) return; await deleteFlow(draft.id); setDraft(null); setSel(null); refresh(); };
  const doRun = async () => {
    if (!draft) return; setRunningNow(true); sfx.connect();
    try { await saveFlow(draft.id, draft); const run = await runFlow(draft.id); setRuns((r) => [run, ...r]); setOpenRun(run.id); if (run.status === 'ok') sfx.success(); else sfx.error(); }
    catch { sfx.error(); } finally { setRunningNow(false); }
  };

  const sched = draft?.schedule || { kind: 'manual' };
  const schedLabel = (s) => s.kind === 'manual' ? 'manual' : s.kind === 'every' ? `a cada ${s.minutes || 60}min` : s.kind === 'hourly' ? `toda hora :${String(s.minute || 0).padStart(2, '0')}` : s.kind === 'daily' ? `diário ${s.time || '06:00'}` : s.kind === 'cron' ? `cron ${s.expr || ''}` : '';

  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9996] grid place-items-center p-4" style={{ background: 'rgba(2,3,8,0.8)', backdropFilter: 'blur(6px)' }} onClick={onClose}>
      <motion.div initial={{ scale: 0.96, y: 14 }} animate={{ scale: 1, y: 0 }}
        className="glass clip-cyber w-full flex flex-col" style={{ maxWidth: 1100, height: '88vh' }} onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="flex items-center gap-2 px-5 py-3" style={{ borderBottom: '1px solid color-mix(in srgb, var(--cyber-primary) 25%, transparent)' }}>
          <Workflow className="w-5 h-5 text-theme" />
          <h2 className="font-display font-bold tracking-cyber text-theme flex-1">FLUXOS DE TAREFAS <span className="text-[10px] font-normal" style={{ color: 'var(--text-dim)' }}>· automação agendada</span></h2>
          <button onClick={onClose}><X className="w-5 h-5" style={{ color: 'var(--text-dim)' }} /></button>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* left rail: flow list */}
          <div className="w-56 shrink-0 flex flex-col border-r" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            <button onClick={addNew} className="btn m-2 flex items-center justify-center gap-1.5" style={{ padding: '6px' }}><Plus className="w-4 h-4" /> NOVO FLUXO</button>
            <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
              {flows.length === 0 && <p className="text-[11px] p-2" style={{ color: 'var(--text-dim)' }}>Nenhum fluxo ainda.</p>}
              {flows.map((f) => (
                <button key={f.id} onClick={() => select(f)}
                  className="w-full text-left rounded-lg border px-2.5 py-2 transition-colors"
                  style={{ borderColor: sel === f.id ? 'var(--cyber-primary)' : 'rgba(255,255,255,0.08)', background: sel === f.id ? 'color-mix(in srgb, var(--cyber-primary) 12%, transparent)' : 'transparent' }}>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: f.enabled ? 'var(--cyber-accent)' : 'var(--text-dim)' }} />
                    <span className="text-[12px] truncate flex-1" style={{ color: 'var(--text)' }}>{f.name}</span>
                  </div>
                  <div className="text-[9px] mt-0.5 flex items-center gap-1" style={{ color: 'var(--text-dim)' }}><Clock className="w-2.5 h-2.5" />{schedLabel(f.schedule || {})}</div>
                </button>
              ))}
            </div>
          </div>

          {/* editor */}
          {!draft ? (
            <div className="flex-1 grid place-items-center text-center px-8">
              <div>
                <Workflow className="w-10 h-10 mx-auto mb-3 opacity-40" style={{ color: 'var(--cyber-primary)' }} />
                <p className="text-sm" style={{ color: 'var(--text-dim)' }}>Selecione um fluxo ou crie um novo.<br />Escolha o servidor SSH, monte os passos (comandos, testes, decisões da IA) e agende.</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 min-w-0 flex">
              {/* center: builder */}
              <div className="flex-1 min-w-0 overflow-y-auto p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} className="field flex-1 font-display" style={{ padding: '8px 10px' }} placeholder="Nome do fluxo" />
                  <button onClick={() => patch({ enabled: !draft.enabled })} title={draft.enabled ? 'Ativado' : 'Desativado'}
                    className="btn flex items-center gap-1.5" style={{ padding: '8px 10px', opacity: draft.enabled ? 1 : 0.5 }}><Power className="w-4 h-4" /> {draft.enabled ? 'ON' : 'OFF'}</button>
                </div>
                <input value={draft.goal || ''} onChange={(e) => patch({ goal: e.target.value })} className="field w-full" style={{ padding: '6px 10px', fontSize: 12 }} placeholder="objetivo (ajuda a IA no report) — ex.: garantir que o nginx está saudável" />

                <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <label className="text-[10px] tracking-cyber flex flex-col gap-1" style={{ color: 'var(--text-dim)' }}>
                    <span className="flex items-center gap-1"><Terminal className="w-3 h-3" /> Servidor SSH</span>
                    <select value={draft.hostId || ''} onChange={(e) => patch({ hostId: e.target.value })} className="field" style={{ padding: '6px 8px' }}>
                      <option value="" style={{ background: 'var(--bg-2)' }}>— escolha um host salvo —</option>
                      {hosts.map((h) => <option key={h.id} value={h.id} style={{ background: 'var(--bg-2)' }}>{h.label} ({h.username}@{h.ip}){h.password ? '' : ' ⚠ sem senha'}</option>)}
                    </select>
                  </label>
                  <div className="text-[10px] tracking-cyber flex flex-col gap-1" style={{ color: 'var(--text-dim)' }}>
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Agendamento</span>
                    <div className="flex gap-1">
                      <select value={sched.kind} onChange={(e) => patch({ schedule: { ...sched, kind: e.target.value } })} className="field" style={{ padding: '6px 8px', flex: 1 }}>
                        <option value="manual" style={{ background: 'var(--bg-2)' }}>Manual</option>
                        <option value="every" style={{ background: 'var(--bg-2)' }}>A cada N min</option>
                        <option value="hourly" style={{ background: 'var(--bg-2)' }}>Toda hora</option>
                        <option value="daily" style={{ background: 'var(--bg-2)' }}>Diário</option>
                        <option value="cron" style={{ background: 'var(--bg-2)' }}>Cron</option>
                      </select>
                      {sched.kind === 'every' && <input type="number" min="1" value={sched.minutes || 60} onChange={(e) => patch({ schedule: { ...sched, minutes: +e.target.value } })} className="field" style={{ padding: '6px 8px', width: 64 }} />}
                      {sched.kind === 'hourly' && <input type="number" min="0" max="59" value={sched.minute || 0} onChange={(e) => patch({ schedule: { ...sched, minute: +e.target.value } })} className="field" style={{ padding: '6px 8px', width: 64 }} />}
                      {sched.kind === 'daily' && <input type="time" value={sched.time || '06:00'} onChange={(e) => patch({ schedule: { ...sched, time: e.target.value } })} className="field" style={{ padding: '6px 8px', width: 110 }} />}
                      {sched.kind === 'cron' && <input value={sched.expr || ''} onChange={(e) => patch({ schedule: { ...sched, expr: e.target.value } })} placeholder="*/15 * * * *" className="field font-mono" style={{ padding: '6px 8px', flex: 1 }} />}
                    </div>
                  </div>
                </div>

                {/* steps flow */}
                <div className="pt-1 space-y-2">
                  <FlowNode label="INÍCIO" color="var(--cyber-accent)" />
                  {draft.steps.map((s, i) => (
                    <React.Fragment key={s.id}>
                      <Connector />
                      <StepCard step={s} index={i} total={draft.steps.length} onChange={(p) => patchStep(s.id, p)} onRemove={() => removeStep(s.id)} onMove={(d) => moveStep(i, d)} />
                    </React.Fragment>
                  ))}
                  <Connector />
                  <FlowNode label="REPORT FINAL (IA)" color="var(--cyber-secondary)" icon={FileText} />
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {Object.entries(STEP_META).map(([t, m]) => (
                      <button key={t} onClick={() => addStep(t)} className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg border border-theme hover:bg-theme-soft transition-colors" style={{ color: m.color }}>
                        <Plus className="w-3 h-3" /> <m.Icon className="w-3.5 h-3.5" /> {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2 pt-2 sticky bottom-0 py-2" style={{ background: 'linear-gradient(transparent, var(--bg-1) 40%)' }}>
                  <button onClick={save} disabled={busy} className="btn flex items-center gap-1.5"><Save className="w-4 h-4" /> Salvar</button>
                  <button onClick={doRun} disabled={runningNow || !draft.hostId} className="btn btn-pink flex items-center gap-1.5">{runningNow ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Rodar agora</button>
                  <button onClick={remove} className="btn btn-ghost ml-auto flex items-center gap-1.5"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>

              {/* right: runs history */}
              <div className="w-72 shrink-0 border-l overflow-y-auto p-3 space-y-2" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                <div className="font-display text-[10px] tracking-cyber" style={{ color: 'var(--text-dim)' }}>HISTÓRICO DE EXECUÇÕES</div>
                {runs.length === 0 && <p className="text-[11px]" style={{ color: 'var(--text-dim)' }}>Nenhuma execução ainda. Use "Rodar agora".</p>}
                {runs.map((run) => (
                  <div key={run.id} className="rounded-lg border" style={{ borderColor: `color-mix(in srgb, ${statusColor(run.status)} 45%, transparent)`, background: `color-mix(in srgb, ${statusColor(run.status)} 8%, transparent)` }}>
                    <button onClick={() => setOpenRun(openRun === run.id ? null : run.id)} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left">
                      {run.status === 'ok' ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: statusColor(run.status) }} /> : run.status === 'running' ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: statusColor(run.status) }} />}
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px]" style={{ color: statusColor(run.status) }}>{run.status.toUpperCase()}</div>
                        <div className="text-[9px] truncate" style={{ color: 'var(--text-dim)' }}>{new Date(run.startedAt).toLocaleString()}</div>
                      </div>
                    </button>
                    <AnimatePresence>
                      {openRun === run.id && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden px-2.5 pb-2">
                          {run.error && <div className="text-[10px] mb-1" style={{ color: 'var(--cyber-danger)' }}>⚠ {run.error}</div>}
                          <div className="space-y-1">
                            {(run.steps || []).map((s, i) => (
                              <div key={i} className="text-[10px] rounded px-1.5 py-1" style={{ background: 'rgba(255,255,255,0.04)' }}>
                                <span className="font-mono" style={{ color: s.pass === false || s.decision === 'no' ? 'var(--cyber-warn)' : 'var(--cyber-accent)' }}>
                                  {s.type === 'ai' ? '🤖' : s.type === 'test' ? (s.pass ? '✓' : '✕') : '$'} {s.name}
                                </span>
                                {s.reason && <div style={{ color: 'var(--text-dim)' }}>↳ {s.reason}</div>}
                              </div>
                            ))}
                          </div>
                          {run.report && <div className="mt-2 text-[10px] whitespace-pre-wrap leading-snug rounded p-2" style={{ background: 'rgba(255,43,214,0.06)', color: 'var(--text)' }}>{run.report}</div>}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}

function FlowNode({ label, color, icon: Icon }) {
  return (
    <div className="flex justify-center">
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-display tracking-cyber" style={{ borderColor: `color-mix(in srgb, ${color} 50%, transparent)`, color, background: `color-mix(in srgb, ${color} 10%, transparent)` }}>
        {Icon && <Icon className="w-3 h-3" />}{label}
      </div>
    </div>
  );
}
function Connector() {
  return <div className="flex justify-center"><div style={{ width: 2, height: 14, background: 'color-mix(in srgb, var(--cyber-primary) 35%, transparent)' }} /></div>;
}

function StepCard({ step, index, total, onChange, onRemove, onMove }) {
  const meta = STEP_META[step.type] || STEP_META.command;
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: `color-mix(in srgb, ${meta.color} 40%, transparent)`, background: 'rgba(8,11,22,0.5)' }}>
      <div className="flex items-center gap-2 px-3 py-1.5" style={{ borderBottom: `1px solid color-mix(in srgb, ${meta.color} 22%, transparent)`, background: `color-mix(in srgb, ${meta.color} 10%, transparent)` }}>
        <meta.Icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
        <span className="font-display text-[10px] tracking-cyber" style={{ color: meta.color }}>{meta.label}</span>
        <span className="text-[9px]" style={{ color: 'var(--text-dim)' }}>#{index + 1}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <button onClick={() => onMove(-1)} disabled={index === 0} className="p-1 rounded hover:bg-black/40 disabled:opacity-30"><ChevronUp className="w-3.5 h-3.5" style={{ color: 'var(--text-dim)' }} /></button>
          <button onClick={() => onMove(1)} disabled={index === total - 1} className="p-1 rounded hover:bg-black/40 disabled:opacity-30"><ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--text-dim)' }} /></button>
          <button onClick={onRemove} className="p-1 rounded hover:bg-black/40"><Trash2 className="w-3.5 h-3.5" style={{ color: 'var(--cyber-danger)' }} /></button>
        </div>
      </div>
      <div className="p-2.5 space-y-2">
        <input value={step.name} onChange={(e) => onChange({ name: e.target.value })} className="field w-full" style={{ padding: '5px 8px', fontSize: 11 }} placeholder="rótulo do passo (opcional)" />
        {step.type === 'ai' ? (
          <>
            <textarea value={step.prompt} onChange={(e) => onChange({ prompt: e.target.value })} rows={2} className="field w-full font-mono" style={{ padding: '6px 8px', fontSize: 11 }} placeholder="O que a IA deve avaliar? ex.: o serviço nginx está ativo e sem erros nos logs?" />
            <label className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--text-dim)' }}>se a IA responder NÃO:
              <select value={step.onNo} onChange={(e) => onChange({ onNo: e.target.value })} className="field" style={{ padding: '4px 6px' }}>
                <option value="stop" style={{ background: 'var(--bg-2)' }}>parar o fluxo</option>
                <option value="continue" style={{ background: 'var(--bg-2)' }}>continuar</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <input value={step.cmd} onChange={(e) => onChange({ cmd: e.target.value })} className="field w-full font-mono" style={{ padding: '6px 8px', fontSize: 11 }} placeholder="comando (ex.: systemctl is-active nginx)" />
            {step.type === 'test' && (
              <div className="flex flex-wrap items-center gap-1.5 text-[10px]" style={{ color: 'var(--text-dim)' }}>
                <span>saída</span>
                <select value={step.op} onChange={(e) => onChange({ op: e.target.value })} className="field" style={{ padding: '4px 6px' }}>
                  {OPS.map(([v, l]) => <option key={v} value={v} style={{ background: 'var(--bg-2)' }}>{l}</option>)}
                </select>
                {!['exit_zero', 'exit_nonzero'].includes(step.op) && <input value={step.value} onChange={(e) => onChange({ value: e.target.value })} className="field font-mono" style={{ padding: '4px 6px', flex: 1, minWidth: 80 }} placeholder="valor esperado" />}
                <span>· se falhar:</span>
                <select value={step.onFail} onChange={(e) => onChange({ onFail: e.target.value })} className="field" style={{ padding: '4px 6px' }}>
                  <option value="stop" style={{ background: 'var(--bg-2)' }}>parar</option>
                  <option value="continue" style={{ background: 'var(--bg-2)' }}>continuar</option>
                </select>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
