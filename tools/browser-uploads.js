import { randomUUID } from './browser-security.js';
import { verifyFiles } from './browser-files.js';
import { fieldError, tooLarge } from '../../NRI-Connect-247-code/app/server/src/lib/errors.ts';
import { audit } from '../../NRI-Connect-247-code/app/server/src/services/events.ts';
import { getSettings } from '../../NRI-Connect-247-code/app/server/src/services/settings.ts';

export const MAX_FILES = 10;
export async function handleUpload(ctx, req, _res, user, authorize) {
  await authorize(ctx.store, null);
  const settings = await getSettings(ctx.store);
  const incoming = req.files || [];
  if (!incoming.length) throw fieldError('files', 'Choose at least one file to upload.');
  if (incoming.length > MAX_FILES) throw fieldError('files', 'Choose at most ten files.');
  if (incoming.some(file => file.size > Math.min(settings.uploads.maxFileSizeMb, 10) * 1024 * 1024)) {
    throw tooLarge('A file exceeds the configured upload limit.');
  }
  const verified = verifyFiles(incoming, settings.uploads.allowedMimeTypes);
  const saved = [];
  try {
    for (const file of verified) saved.push(await ctx.files.save(file));
    return await ctx.store.transaction(async tx => {
      const link = await authorize(tx, req.body || {});
      const result = [];
      for (const [index, file] of verified.entries()) {
        const item = await tx.insert('attachments', {
          id: randomUUID(), ownerUserId: user.id, ...link, filename: file.filename,
          mimeType: file.mimeType, ...saved[index], createdAt: new Date().toISOString(),
        });
        await audit(tx, user, 'attachment.uploaded', 'attachment', item.id, { ...link, filename: item.filename });
        result.push(item);
      }
      return result;
    });
  } catch (error) {
    await Promise.all(saved.map(file => ctx.files.remove(file.storageKey)));
    throw error;
  }
}
