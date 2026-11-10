import { Router, runHandlers } from './browser-router.js';
import { BrowserStore, readSession, saveSession, storageStatus } from './browser-store.js';
import { FieldCipher, randomUUID, randomToken, sha256 } from './browser-security.js';
import { FileStorage } from './browser-files.js';
import { seed } from '../../NRI-Connect-247-code/app/server/src/seed.ts';
import { sessionMiddleware, requireAuth, startSession } from '../../NRI-Connect-247-code/app/server/src/auth/session.ts';
import { toUser } from '../../NRI-Connect-247-code/app/server/src/views.ts';
import { authRoutes } from '../../NRI-Connect-247-code/app/server/src/routes/auth.ts';
import { adminRoutes } from '../../NRI-Connect-247-code/app/server/src/routes/admin.ts';
import { propertyRoutes } from '../../NRI-Connect-247-code/app/server/src/routes/properties.ts';
import { requestRoutes } from '../../NRI-Connect-247-code/app/server/src/routes/requests.ts';
import { visitRoutes } from '../../NRI-Connect-247-code/app/server/src/routes/visits.ts';
import { attachmentRoutes } from '../../NRI-Connect-247-code/app/server/src/routes/attachments.ts';
import { meRoutes } from '../../NRI-Connect-247-code/app/server/src/routes/me.ts';
import { categoryRoutes } from '../../NRI-Connect-247-code/app/server/src/routes/categories.ts';
import { authorizationRoutes } from '../../NRI-Connect-247-code/app/server/src/routes/authorizations.ts';
import { notificationRoutes } from '../../NRI-Connect-247-code/app/server/src/routes/notifications.ts';

export const store = new BrowserStore();
export const files = new FileStorage();
let cookie = readSession();
export const ctx = {
  store, files, cipher: new FieldCipher(),
  config: { production: false, logEmails: false, rateLimit: false, storageDir: 'browser-only', appUrl: `${location.href.split('#')[0]}#` },
};
const initialize = async () => {
  if ((await store.all('users')).length) return;
  await seed(ctx);
  // Keep sample permissions valid whenever the prototype is opened in the future.
  for (const auth of await store.all('property_authorizations')) {
    await store.update('property_authorizations', auth.id, { expiresAt: new Date(Date.now() + 180 * 86400000).toISOString() });
  }
  await addExampleEvidence();
};

async function addExampleEvidence() {
  const canvas = document.createElement('canvas');
  canvas.width = 900; canvas.height = 500;
  const drawing = canvas.getContext('2d');
  if (!drawing) return;
  drawing.fillStyle = '#e6f4f2'; drawing.fillRect(0, 0, 900, 500);
  drawing.fillStyle = '#142b4a'; drawing.font = 'bold 31px Arial'; drawing.fillText('NRI Connect 24/7', 45, 60);
  drawing.fillStyle = '#147d78'; drawing.fillRect(250, 200, 400, 220);
  drawing.beginPath(); drawing.moveTo(210, 210); drawing.lineTo(450, 95); drawing.lineTo(690, 210); drawing.fill();
  drawing.fillStyle = '#fff'; drawing.fillRect(300, 245, 85, 80); drawing.fillRect(515, 245, 85, 80);
  drawing.fillStyle = '#f4a93c'; drawing.fillRect(420, 305, 60, 115);
  drawing.fillStyle = '#62718a'; drawing.font = '20px Arial'; drawing.fillText('Illustrative visit evidence - sample image', 45, 470);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return;
  for (const visit of (await store.all('visits')).filter(item => item.outcome === 'completed')) {
    const saved = await files.save({ filename: 'sample-visit.png', mimeType: 'image/png', buffer: new Uint8Array(await blob.arrayBuffer()) });
    await store.insert('attachments', {
      ...saved, id: randomUUID(), ownerUserId: visit.engineerId, requestId: visit.requestId,
      visitId: visit.id, propertyId: null, filename: 'sample-visit.png', mimeType: 'image/png', createdAt: visit.completedAt,
    });
  }
}
export const ready = initialize();

const authRouter = authRoutes(ctx);
const adminRouter = adminRoutes(ctx);
const commonRouter = Router();
for (const factory of [meRoutes, propertyRoutes, requestRoutes, visitRoutes, attachmentRoutes, categoryRoutes, authorizationRoutes, notificationRoutes]) {
  commonRouter.routes.push(...factory(ctx).routes);
}

function setSession(value, maxAge) { cookie = value; saveSession(value, maxAge); }
function responseAdapter(resolve, reject) {
  const response = {
    code: 200, payload: undefined, headers: {}, finished: false,
    status(code) { this.code = code; return this; },
    set(headers) { Object.assign(this.headers, headers); return this; },
    cookie(_name, token, options = {}) { setSession(token, options.maxAge); return this; },
    clearCookie() { setSession(null); return this; },
    json(payload) { this.payload = payload; this.finished = true; resolve(this); return this; },
    send(payload) { this.payload = payload; this.finished = true; resolve(this); return this; },
    end() { this.finished = true; resolve(this); return this; },
    destroy(error) { reject(error); },
    get headersSent() { return this.finished; },
  };
  return response;
}

async function decorateAttachments(value) {
  if (!value || typeof value !== 'object' || value instanceof Blob) return value;
  if (Array.isArray(value)) return Promise.all(value.map(decorateAttachments));
  if (typeof value.url === 'string' && value.url.startsWith('/api/v1/attachments/')) {
    const attachment = await store.get('attachments', value.id);
    if (attachment) value.url = await files.url(attachment.storageKey);
  }
  for (const key of Object.keys(value)) {
    if (value[key] && typeof value[key] === 'object') value[key] = await decorateAttachments(value[key]);
  }
  return value;
}

function errorResponse(error) {
  if (error?.name === 'ZodError') {
    const fields = {};
    for (const issue of error.issues) fields[issue.path.join('.') || '_'] ??= issue.message;
    return new Response(JSON.stringify({ error: { code: 'validation_error', message: 'Please check the highlighted fields.', fields } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  if (!error.status) console.error('Prototype action failed:', error);
  return new Response(JSON.stringify({ error: {
    code: error.code || 'internal_error', message: error.status ? error.message : 'The demo action could not be saved. Please try again.',
    ...(error.fields ? { fields: error.fields } : {}),
  } }), { status: error.status || 500, headers: { 'Content-Type': 'application/json' } });
}

export async function demoFetch(input, options = {}) {
  const raw = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
  // A Windows file:// base turns /api/... into /C:/api/.... Use a fixed parsing
  // origin instead; this address is never fetched or contacted.
  const url = new URL(raw, 'https://nri-connect-demo.invalid/');
  if (!url.pathname.startsWith('/api/v1/')) {
    // The self-contained demo never sends forms or data to an external service.
    throw new Error('This prototype only supports local demo requests.');
  }
  await ready;
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const method = (options.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  let pathname = decodeURI(url.pathname.slice('/api/v1'.length));
  if (pathname === '/health') return Response.json({ ok: true, mode: 'static-prototype' });
  const router = pathname.startsWith('/auth/') ? authRouter : pathname.startsWith('/admin/') ? adminRouter : commonRouter;
  const isPublic = router === authRouter;
  if (router === authRouter) pathname = pathname.slice('/auth'.length);
  if (router === adminRouter) pathname = pathname.slice('/admin'.length);
  const route = router.routes.find(item => item.method === method && item.regex.test(pathname));
  if (!route) return new Response(JSON.stringify({ error: { code: 'not_found', message: 'This demo page or action was not found.' } }), { status: 404 });
  const values = pathname.match(route.regex).slice(1);
  const request = {
    method, path: pathname, originalUrl: url.pathname + url.search,
    params: Object.fromEntries(route.keys.map((key, index) => [key, decodeURIComponent(values[index])])),
    query: Object.fromEntries(url.searchParams), cookies: { ppo_session: cookie }, body: {}, files: [],
  };
  try {
    if (options.body instanceof FormData) {
      for (const [key, value] of options.body.entries()) {
        if (value instanceof Blob && key === 'files') {
          request.files.push({ originalname: value.name || 'upload', mimetype: value.type, size: value.size, buffer: new Uint8Array(await value.arrayBuffer()) });
        } else request.body[key] = String(value);
      }
    } else if (options.body) request.body = JSON.parse(String(options.body));
    let complete;
    let fail;
    const completed = new Promise((resolve, reject) => { complete = resolve; fail = reject; });
    const response = responseAdapter(complete, fail);
    await runHandlers([sessionMiddleware(ctx), ...(!isPublic ? [requireAuth] : []), ...route.handlers], request, response);
    const result = await completed;
    if (result.code === 204) return new Response(null, { status: 204 });
    if (result.payload instanceof Blob) return new Response(result.payload, { status: result.code, headers: result.headers });
    const decorated = await decorateAttachments(structuredClone(result.payload));
    return new Response(JSON.stringify(decorated ?? null), { status: result.code, headers: { 'Content-Type': 'application/json', ...result.headers } });
  } catch (error) { return errorResponse(error); }
}

// Existing upload widgets use XHR for progress. Keep their interface, with no network.
class DemoXMLHttpRequest extends EventTarget {
  constructor() { super(); this.upload = new EventTarget(); this.upload.onprogress = null; this.headers = {}; this.status = 0; this.responseText = ''; this.readyState = 0; this.aborted = false; }
  open(method, url) { this.method = method; this.url = url; this.readyState = 1; }
  setRequestHeader(key, value) { this.headers[key] = value; }
  abort() { this.aborted = true; this.onabort?.(); }
  async send(body) {
    try {
      const total = body instanceof FormData ? [...body.values()].reduce((sum, value) => sum + (value.size || 0), 0) : 1;
      this.upload.onprogress?.({ lengthComputable: true, loaded: 0, total });
      const response = await demoFetch(this.url, { method: this.method, headers: this.headers, body });
      if (this.aborted) return;
      this.status = response.status;
      this.responseText = await response.text();
      this.readyState = 4;
      this.upload.onprogress?.({ lengthComputable: true, loaded: total, total });
      this.onload?.(); this.dispatchEvent(new Event('load'));
    } catch { if (!this.aborted) this.onerror?.(); }
  }
}
globalThis.fetch = demoFetch;
globalThis.XMLHttpRequest = DemoXMLHttpRequest;

export async function switchPersona(id) {
  await ready;
  const user = await store.get('users', id);
  if (!user || user.status !== 'active') throw new Error('This demo account is disabled.');
  const response = responseAdapter(() => {}, () => {});
  await startSession(ctx, response, user, false);
  return toUser(user);
}
export async function resetDemo() {
  await files.clear();
  await store.reset();
  setSession(null);
  await initialize();
}
export async function demoUsers() { await ready; return (await store.all('users')).map(toUser); }
export async function inbox() { await ready; return (await store.find('notifications', mail => mail.channel === 'email')).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
export function exportDemo() {
  const collections = structuredClone(store.data);
  delete collections.sessions; delete collections.auth_tokens;
  collections.users = (collections.users || []).map(({ passwordHash, ...user }) => user);
  for (const property of collections.properties || []) delete property.accessNotesEnc;
  for (const notification of collections.notifications || []) if (notification.templateKey?.startsWith('auth.')) notification.link = null;
  const url = URL.createObjectURL(new Blob([JSON.stringify({ prototype: true, exportedAt: new Date().toISOString(), collections }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'nri-connect-demo-data.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export { storageStatus };
// Deliberately exposed for inspecting demo state and automated browser verification.
globalThis.NRI_DEMO = { fetch: demoFetch, ready, store, files, switchPersona, reset: resetDemo, users: demoUsers, inbox };
