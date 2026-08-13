import React, { useState } from 'react';
import {
  Check, Eraser, LogIn, Pencil, Plus, Power, RefreshCw, Share2,
  ShieldAlert, SquareTerminal, X,
} from 'lucide-react';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;

const STATUS = {
  detached: { label: 'Disponível', tone: 'var(--cyber-accent)' },
  attached: { label: 'Em uso', tone: 'var(--cyber-warn)' },
  multi: { label: 'Compartilhada', tone: 'var(--cyber-primary)' },
  remote: { label: 'Remota', tone: 'var(--cyber-warn)' },
  dead: { label: 'Inativa', tone: 'var(--cyber-danger)' },
};

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\"'\"'") + "'";
}

function ActionButton({ icon: Icon, children, tone = 'var(--cyber-primary)', disabled, title, onClick }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 font-mono text-[10px] transition-[filter,opacity] duration-150 hover:brightness-125 active:brightness-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100"
      style={{
        minHeight: 44,
        color: tone,
        background: 'color-mix(in srgb, ' + tone + ' 11%, transparent)',
        border: '1px solid color-mix(in srgb, ' + tone + ' 30%, transparent)',
        outlineColor: tone,
      }}>
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      {children}
    </button>
  );
}

function CommandPreview({ command }) {
  if (!command) return null;
  return (
    <div className="rounded-lg px-2.5 py-2 font-mono text-[10px] break-all"
      style={{ color: 'var(--text-dim)', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)' }}
      aria-live="polite">
      Executado no terminal: <span style={{ color: 'var(--cyber-primary)' }}>$ {command}</span>
    </div>
  );
}

export default function ScreenSessionsSection({ data, onRunCommand }) {
  const sessions = data.sessions || [];
  const deadCount = sessions.filter((session) => session.status === 'dead').length;
  const [newName, setNewName] = useState('');
  const [renameId, setRenameId] = useState('');
  const [renameName, setRenameName] = useState('');
  const [quitId, setQuitId] = useState('');
  const [lastCommand, setLastCommand] = useState('');
  const [error, setError] = useState('');

  const execute = (command, close = true) => {
    setError('');
    const ok = onRunCommand?.(command, { close });
    if (!ok) {
      setError('Não foi possível enviar o comando: a sessão SSH não está conectada.');
      return false;
    }
    setLastCommand(command);
    return true;
  };

  const create = (detached) => {
    const name = newName.trim();
    if (!NAME_RE.test(name)) {
      setError('Use de 1 a 80 caracteres: letras, números, ponto, hífen ou sublinhado.');
      return;
    }
    let command = 'screen ' + (detached ? '-dmS ' : '-S ') + shellQuote(name);
    if (detached) command += '; screen -ls';
    if (execute(command, !detached)) setNewName('');
  };

  const rename = (session) => {
    const name = renameName.trim();
    if (!NAME_RE.test(name)) {
      setError('O novo nome deve usar apenas letras, números, ponto, hífen ou sublinhado.');
      return;
    }
    const command = 'screen -S ' + shellQuote(session.id) + ' -X sessionname ' + shellQuote(name);
    if (execute(command + '; screen -ls', false)) {
      setRenameId('');
      setRenameName('');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-mono text-[11px]" style={{ color: 'var(--text)' }}>
            {sessions.length} sessão(ões) detectada(s)
          </div>
          {data.socketDir && (
            <div className="mt-0.5 max-w-[310px] truncate font-mono text-[9px]" style={{ color: 'var(--text-dim)' }} title={data.socketDir}>
              Socket: {data.socketDir}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <ActionButton icon={RefreshCw} title="Executar screen -ls novamente" onClick={() => execute('screen -ls', false)}>
            Atualizar
          </ActionButton>
          <ActionButton icon={Eraser} disabled={!deadCount} tone="var(--cyber-warn)"
            title="Remover sockets de sessões mortas" onClick={() => execute('screen -wipe; screen -ls', false)}>
            Limpar inativas{deadCount ? ' (' + deadCount + ')' : ''}
          </ActionButton>
        </div>
      </div>

      <div className="rounded-xl p-3" style={{ background: 'rgba(0,240,255,0.035)', border: '1px solid color-mix(in srgb, var(--cyber-primary) 24%, transparent)' }}>
        <label htmlFor="screen-session-name" className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
          Nova sessão
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input id="screen-session-name" value={newName} onChange={(event) => { setNewName(event.target.value); setError(''); }}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); create(false); } }}
            className="field min-w-0 flex-1 py-2 text-[12px]" placeholder="nome-da-sessao" maxLength={80}
            autoComplete="off" spellCheck={false} aria-describedby="screen-name-help" style={{ minHeight: 44 }} />
          <div className="flex flex-wrap gap-1.5">
            <ActionButton icon={Plus} disabled={!newName.trim()} onClick={() => create(false)}
              title="Criar a sessão e entrar nela">
              Criar e entrar
            </ActionButton>
            <ActionButton icon={SquareTerminal} disabled={!newName.trim()} tone="var(--cyber-accent)"
              onClick={() => create(true)} title="Criar a sessão sem entrar nela">
              Criar em background
            </ActionButton>
          </div>
        </div>
        <div id="screen-name-help" className="mt-1.5 font-mono text-[9px]" style={{ color: 'var(--text-dim)' }}>
          Letras, números, ponto, hífen e sublinhado; até 80 caracteres.
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg px-2.5 py-2 font-mono text-[10px]"
          style={{ color: 'var(--cyber-danger)', background: 'rgba(255,56,96,0.1)', border: '1px solid rgba(255,56,96,0.32)' }}>
          {error}
        </div>
      )}

      {!sessions.length ? (
        <div className="rounded-xl px-3 py-5 text-center" style={{ border: '1px dashed color-mix(in srgb, var(--text-dim) 35%, transparent)' }}>
          <SquareTerminal className="mx-auto mb-2 h-5 w-5" style={{ color: 'var(--text-dim)' }} aria-hidden="true" />
          <div className="font-mono text-[11px]" style={{ color: 'var(--text)' }}>Nenhuma sessão ativa</div>
          <div className="mt-1 font-mono text-[9px]" style={{ color: 'var(--text-dim)' }}>Dê um nome acima para criar a primeira.</div>
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((session) => {
            const status = STATUS[session.status] || STATUS.remote;
            const isDead = session.status === 'dead';
            const attachCommand = session.status === 'detached'
              ? 'screen -r ' + shellQuote(session.id)
              : 'screen -d -r ' + shellQuote(session.id);
            const isRenaming = renameId === session.id;
            const isQuitting = quitId === session.id;
            return (
              <div key={session.id} className="rounded-xl p-3"
                style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.09)' }}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-mono text-[12px] font-semibold" style={{ color: 'var(--text)' }}>{session.name}</span>
                      <span className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[8px] uppercase"
                        style={{ color: status.tone, background: 'color-mix(in srgb, ' + status.tone + ' 13%, transparent)', border: '1px solid color-mix(in srgb, ' + status.tone + ' 28%, transparent)' }}>
                        {status.label}
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono text-[9px]" style={{ color: 'var(--text-dim)' }}>
                      PID {session.pid}{session.date ? ' · ' + session.date : ''} · {session.id}
                    </div>
                  </div>
                </div>

                {!isDead && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <ActionButton icon={LogIn} onClick={() => execute(attachCommand)}
                      title={session.status === 'detached' ? 'Entrar nesta sessão' : 'Desanexar do outro terminal e entrar aqui'}>
                      {session.status === 'detached' ? 'Entrar' : 'Assumir sessão'}
                    </ActionButton>
                    <ActionButton icon={Share2} tone="var(--cyber-accent)"
                      onClick={() => execute('screen -x ' + shellQuote(session.id))}
                      title="Entrar sem desconectar o outro terminal">
                      Compartilhar
                    </ActionButton>
                    <ActionButton icon={ShieldAlert} tone="var(--cyber-warn)"
                      onClick={() => execute('screen -D -r ' + shellQuote(session.id))}
                      title="Forçar a desconexão remota e assumir a sessão">
                      Forçar entrada
                    </ActionButton>
                    <ActionButton icon={Pencil} tone="var(--text-dim)" onClick={() => {
                      setQuitId('');
                      setRenameId(isRenaming ? '' : session.id);
                      setRenameName(session.name);
                    }}>
                      Renomear
                    </ActionButton>
                    <ActionButton icon={Power} tone="var(--cyber-danger)" onClick={() => {
                      setRenameId('');
                      setQuitId(isQuitting ? '' : session.id);
                    }}>
                      Encerrar
                    </ActionButton>
                  </div>
                )}

                {isDead && (
                  <div className="mt-2.5">
                    <ActionButton icon={Eraser} tone="var(--cyber-warn)" onClick={() => execute('screen -wipe; screen -ls', false)}>
                      Remover socket inativo
                    </ActionButton>
                  </div>
                )}

                {isRenaming && (
                  <div className="mt-2.5 flex flex-col gap-1.5 sm:flex-row">
                    <label className="sr-only" htmlFor={'screen-rename-' + session.pid}>Novo nome da sessão</label>
                    <input id={'screen-rename-' + session.pid} className="field min-w-0 flex-1 py-2 text-[11px]"
                      value={renameName} onChange={(event) => setRenameName(event.target.value)} maxLength={80}
                      autoFocus autoComplete="off" spellCheck={false} style={{ minHeight: 44 }}
                      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); rename(session); } }} />
                    <ActionButton icon={Check} tone="var(--cyber-accent)" onClick={() => rename(session)}>Salvar nome</ActionButton>
                    <ActionButton icon={X} tone="var(--text-dim)" onClick={() => setRenameId('')}>Cancelar</ActionButton>
                  </div>
                )}

                {isQuitting && (
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg px-2.5 py-2"
                    style={{ background: 'rgba(255,56,96,0.08)', border: '1px solid rgba(255,56,96,0.28)' }}>
                    <span className="font-mono text-[10px]" style={{ color: 'var(--cyber-danger)' }}>
                      Encerrar “{session.name}” e todos os processos nela?
                    </span>
                    <div className="flex gap-1.5">
                      <ActionButton icon={Power} tone="var(--cyber-danger)" onClick={() => {
                        if (execute('screen -S ' + shellQuote(session.id) + ' -X quit; screen -ls', false)) setQuitId('');
                      }}>
                        Confirmar
                      </ActionButton>
                      <ActionButton icon={X} tone="var(--text-dim)" onClick={() => setQuitId('')}>Cancelar</ActionButton>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <CommandPreview command={lastCommand} />
    </div>
  );
}
