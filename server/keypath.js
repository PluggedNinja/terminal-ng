/**
 * keypath.js — confina os caminhos de chave privada SSH lidos do disco DO SERVIDOR.
 *
 * Sem confinamento, qualquer usuário autenticado do app podia informar um keyPath
 * arbitrário (ex.: /root/.ssh/id_rsa, chaves de outros usuários) e fazer o backend
 * ler esse arquivo — leitura arbitrária de arquivo + oráculo de existência/formato.
 *
 * Por padrão só é permitido ler dentro do HOME do usuário que roda o backend.
 * Sobrescreva com TNG_SSH_KEY_DIRS (lista separada pelo delimitador de PATH do SO)
 * para apontar diretórios adicionais onde as chaves ficam.
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

function allowedRoots() {
  const env = String(process.env.TNG_SSH_KEY_DIRS || '')
    .split(path.delimiter).map((s) => s.trim()).filter(Boolean);
  const raw = env.length ? env : [os.homedir()];
  const out = [];
  for (const r of raw) {
    try { out.push(fs.realpathSync(r)); } catch { out.push(path.resolve(r)); }
  }
  return out;
}

/** true se `p` (arquivo ou diretório) estiver dentro de um dos diretórios permitidos. */
export function isAllowedKeyPath(p) {
  if (!p) return false;
  let real;
  // realpath resolve symlinks (impede escapar do confinamento via link); se o
  // caminho ainda não existe, cai para resolve() para validar o alvo pretendido.
  try { real = fs.realpathSync(p); } catch { real = path.resolve(String(p)); }
  for (const root of allowedRoots()) {
    const rel = path.relative(root, real);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return true;
  }
  return false;
}
