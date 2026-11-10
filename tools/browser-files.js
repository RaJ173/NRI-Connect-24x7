import { randomUUID, sha256 } from './browser-security.js';
import { fileOperation, localFileUrl, revokeFileUrl, revokeAllFileUrls } from './browser-store.js';
import { unsupportedMedia, tooLarge } from '../../NRI-Connect-247-code/app/server/src/lib/errors.ts';

export const SNIFFABLE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const prefix = (bytes, sequence) => sequence.every((byte, index) => bytes[index] === byte);
export function sniffMimeType(bytes) {
  if (prefix(bytes, [255, 216, 255])) return 'image/jpeg';
  if (prefix(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png';
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-') return 'application/pdf';
  return null;
}
export function sanitizeFilename(name) {
  return String(name).replaceAll('\\', '/').split('/').pop().normalize('NFC')
    .replace(/[^\p{L}\p{N}._\- ()]/gu, '_').replace(/^[.\s]+/, '').trim().slice(-120) || 'file';
}
export function verifyFiles(files, allowedMimeTypes) {
  return files.map(file => {
    const actual = sniffMimeType(file.buffer);
    const declared = file.mimetype === 'image/jpg' ? 'image/jpeg' : file.mimetype;
    if (!actual || actual !== declared || !allowedMimeTypes.includes(actual)) {
      throw unsupportedMedia(`"${sanitizeFilename(file.originalname)}" is not an allowed file type.`);
    }
    return { filename: sanitizeFilename(file.originalname), mimeType: actual, buffer: file.buffer };
  });
}
export class FileStorage {
  async save(file) {
    // Bound memory use in the offline prototype, independently of production settings.
    if (file.buffer.length > 10 * 1024 * 1024) throw tooLarge('Use files up to 10 MB in this prototype.');
    const storageKey = randomUUID();
    await fileOperation('put', storageKey, new Blob([file.buffer], { type: file.mimeType }));
    return { storageKey, checksum: sha256(file.buffer), sizeBytes: file.buffer.length };
  }
  open(key) {
    const events = {};
    const stream = {
      once(name, callback) { events[name] = callback; return stream; },
      pipe(response) {
        fileOperation('get', key).then(blob => response.send(blob)).catch(error => events.error?.(error));
        return response;
      },
    };
    queueMicrotask(async () => {
      try {
        if (!await fileOperation('get', key)) throw new Error('Demo file was not found.');
        events.open?.();
      } catch (error) { events.error?.(error); }
    });
    return stream;
  }
  async remove(key) { revokeFileUrl(key); await fileOperation('delete', key); }
  async clear() { revokeAllFileUrls(); await fileOperation('clear'); }
  async url(key) { return localFileUrl(key); }
}
