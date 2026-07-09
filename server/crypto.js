/**
 * crypto.js — cifragem de segredos em repouso (senhas SSH, tokens OAuth, API keys).
 *
 * Usa AES-256-GCM com uma chave derivada (scrypt) de TNG_ENC_KEY. Se TNG_ENC_KEY
 * não for definida, deriva de JWT_SECRET como fallback — assim o app continua
 * funcionando "out of the box", mas o ideal é definir TNG_ENC_KEY em produção.
 *
 * Formato do texto cifrado:  enc:v1:<ivB64url>:<tagB64url>:<ctB64url>
 * Valores sem esse prefixo são tratados como texto puro (migração transparente:
 * lê o que já existe; a próxima gravação re-cifra).
 */
import crypto from 'node:crypto';

const PREFIX = 'enc:v1:';
let cachedKey = null;

function keyMaterial() {
  return (
    process.env.TNG_ENC_KEY ||
    process.env.JWT_SECRET ||
    'dev-insecure-secret-change-me'
  );
}

function getKey() {
  if (cachedKey) return cachedKey;
  // Sal fixo (a chave já é secreta): scrypt só normaliza o comprimento para 32 bytes.
  cachedKey = crypto.scryptSync(keyMaterial(), 'terminal-ng.enc.v1', 32);
  return cachedKey;
}

/** Cifra uma string. Retorna null/'' inalterado. */
export function encryptSecret(plain) {
  if (plain == null || plain === '') return plain;
  const s = String(plain);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(s, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${ct.toString('base64url')}`;
}

/** Decifra. Se não estiver no formato cifrado, devolve como veio (texto puro legado). */
export function decryptSecret(value) {
  if (value == null || value === '') return value;
  const s = String(value);
  if (!s.startsWith(PREFIX)) return s; // texto puro legado
  try {
    const [ivB64, tagB64, ctB64] = s.slice(PREFIX.length).split(':');
    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    const ct = Buffer.from(ctB64, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return ''; // chave errada ou dado corrompido — não vaza o ciphertext
  }
}

export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}
