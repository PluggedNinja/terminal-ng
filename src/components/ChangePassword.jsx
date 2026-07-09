import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { KeyRound, X, Check } from 'lucide-react';
import { api } from '../lib/api.js';
import { sfx } from '../lib/sound.js';

export default function ChangePassword({ onClose }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      await api.post('/auth/change-password', { currentPassword: cur, newPassword: next });
      sfx.success(); setMsg({ ok: true, text: 'Passkey updated.' });
      setTimeout(onClose, 900);
    } catch (err) {
      sfx.error(); setMsg({ ok: false, text: err.message }); setBusy(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: 'rgba(2,3,8,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} className="glass clip-cyber w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-4">
          <KeyRound className="w-5 h-5 text-theme" />
          <h2 className="font-display font-bold tracking-cyber text-theme flex-1">Change Passkey</h2>
          <button onClick={onClose}><X className="w-5 h-5" style={{ color: 'var(--text-dim)' }} /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input type="password" className="field font-mono" placeholder="current passkey" value={cur} onChange={(e) => setCur(e.target.value)} />
          <input type="password" className="field font-mono" placeholder="new passkey" value={next} onChange={(e) => setNext(e.target.value)} />
          {msg && <p className="text-sm" style={{ color: msg.ok ? 'var(--cyber-accent)' : 'var(--cyber-danger)' }}>{msg.text}</p>}
          <button type="submit" disabled={busy} className="btn w-full flex items-center justify-center gap-2">
            <Check className="w-4 h-4" /> {busy ? 'updating…' : 'update'}
          </button>
        </form>
      </motion.div>
    </motion.div>
  );
}
