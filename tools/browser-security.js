// Prototype-only replacements. These are not production authentication/encryption.
export const randomUUID = () => globalThis.crypto?.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const n = Math.floor(Math.random() * 16); return (c === 'x' ? n : (n & 3) | 8).toString(16);
});
export const randomToken = () => randomUUID() + randomUUID();
export function sha256(value) {
  // Stable browser-local identifiers; never used to authenticate a real account.
  const text = typeof value === 'string' ? value : Array.from(value).join(',');
  let first = 2166136261;
  let second = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    first = Math.imul(first ^ text.charCodeAt(i), 16777619);
    second = Math.imul(second ^ text.charCodeAt(i), 2246822519);
  }
  return `demo-${(first >>> 0).toString(16)}-${(second >>> 0).toString(16)}-${text.length}`;
}
export async function hashPassword(password) { return sha256(`prototype-password:${password}`); }
export async function verifyPassword(password, stored) { return !!stored && await hashPassword(password) === stored; }
export const newReference = () => `PPO-${randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase()}`;
export class FieldCipher {
  encrypt(value) { return String(value); }
  decrypt(value) { return String(value); }
}
