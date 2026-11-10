// A small in-browser transport for the existing route handlers, not a web server.
export function Router() {
  const middleware = [];
  const routes = [];
  const router = {
    routes,
    use(...handlers) { middleware.push(...handlers); return router; },
  };
  for (const method of ['get', 'post', 'patch', 'put', 'delete']) {
    router[method] = (path, ...handlers) => {
      const keys = [];
      const expression = path.split('/').map(part => {
        if (part.startsWith(':')) { keys.push(part.slice(1)); return '([^/]+)'; }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('/');
      routes.push({ method: method.toUpperCase(), regex: new RegExp(`^${expression}/?$`), keys, handlers: [...middleware, ...handlers] });
      return router;
    };
  }
  return router;
}

export async function runHandlers(handlers, req, res) {
  let index = 0;
  const next = async error => {
    if (error) throw error;
    const handler = handlers[index++];
    if (!handler || res.finished) return;
    let continuation;
    await handler(req, res, error => { continuation = next(error); return continuation; });
    if (continuation) await continuation;
  };
  await next();
}
