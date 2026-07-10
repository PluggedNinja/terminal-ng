/**
 * hostkeys.js — verificação de host key SSH (TOFU: trust on first use).
 * Compartilhado entre a sessão interativa (terminalService.js) e os fluxos
 * agendados (flows.js), usando a MESMA tabela knownhosts — uma chave
 * memorizada no terminal vale para a automação e vice-versa.
 *
 * Guarda o fingerprint (SHA-256, base64) por usuário+host. No 1º acesso
 * confia e persiste; depois recusa se a chave do servidor mudar
 * (defesa contra man-in-the-middle).
 */
import crypto from 'node:crypto';
import { readTable, writeTable } from './store.js';

export function hostKeyFingerprint(keyBuf) {
  return crypto.createHash('sha256').update(keyBuf).digest('base64');
}

export function verifyHostKey(userId, hostKey, keyBuf) {
  const all = readTable('knownhosts', {});
  const forUser = all[userId] || {};
  const fp = hostKeyFingerprint(keyBuf);
  const known = forUser[hostKey];
  if (!known) { // TOFU: primeira vez → confia e memoriza
    forUser[hostKey] = fp; all[userId] = forUser; writeTable('knownhosts', all);
    return { ok: true, first: true };
  }
  if (known === fp) return { ok: true };
  return { ok: false, expected: known, got: fp };
}
