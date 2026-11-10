import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(target, '../NRI-Connect-247-code/app');
const tools = path.join(target, 'tools');
const { build } = await import(pathToFileURL(path.join(source, 'node_modules/vite/dist/node/index.js')).href);
const slash = value => value.replaceAll('\\', '/');
const plugin = {
  name: 'nri-static-prototype',
  enforce: 'pre',
  resolveId(id, importer) {
    if (id === 'express') return path.join(tools, 'browser-router.js');
    if (id === 'node:crypto') return path.join(tools, 'browser-security.js');
    if (importer && slash(importer).includes('/server/')) {
      if (/lib\/security(?:\.ts)?$/.test(id)) return path.join(tools, 'browser-security.js');
      if (/files\/FileStorage(?:\.ts)?$/.test(id)) return path.join(tools, 'browser-files.js');
      if (/services\/uploads(?:\.ts)?$/.test(id)) return path.join(tools, 'browser-uploads.js');
    }
    if (/^[A-Za-z@]/.test(id) && !id.startsWith('node:')) {
      return this.resolve(id, path.join(source, 'client/src/main.tsx'), { skipSelf: true });
    }
  },
  transform(code, id) {
    id = slash(id).split('?')[0];
    if (id.endsWith('/server/src/seed.ts')) {
      return code.split('// `npm run seed`:')[0]
        .replace(/^import path from 'node:path';\r?\n/m, '')
        .replace(/^import \{[^\n]+\} from 'node:url';\r?\n/m, '');
    }
    if (id.endsWith('/client/src/main.tsx')) {
      return `import ${JSON.stringify(slash(path.join(tools, 'demo-runtime.js')))};\nimport { DemoToolbar } from ${JSON.stringify(slash(path.join(tools, 'DemoToolbar.tsx')))};\n` + code
        .replaceAll('BrowserRouter', 'HashRouter')
        .replace('<App />', '<DemoToolbar /><App />');
    }
    if (id.endsWith('/client/src/App.tsx')) {
      return code.replace(/const (\w+) = lazy\(\(\) => import\('([^']+)'\)\);/g, 'import $1 from "$2";');
    }
    if (id.endsWith('/client/src/pages/public/Landing.tsx')) {
      return code.replace(/href="#(how|services|about)"/g, 'href="#/" onClick={(event) => { event.preventDefault(); document.getElementById("$1")?.scrollIntoView({ behavior: "smooth" }); }}');
    }
    if (id.endsWith('/client/src/pages/customer/PropertyForm.tsx')) {
      return code.replace(/hint="Stored encrypted\.[^"]*"/, 'hint="Sample notes stay in this browser. In the demo they are visible to operations and assigned engineers, but not representatives."');
    }
    if (id.endsWith('/client/src/pages/public/Login.tsx')) {
      return code.replace('Secure sign in', 'Demo sign in');
    }
    if (id.includes('vite/preload-helper')) return code.replaceAll('import.meta.resolve', 'undefined');
  },
  transformIndexHtml(html) {
    return html.replace(/<link[^>]+(?:fonts\.googleapis|fonts\.gstatic)[^>]*>/g, '');
  },
};

await build({
  root: path.join(source, 'client'),
  configFile: path.join(source, 'client/vite.config.ts'),
  plugins: [plugin],
  base: './',
  define: { 'import.meta.url': 'location.href', 'import.meta.hot': 'false' },
  build: {
    outDir: path.join(target, '.build'),
    emptyOutDir: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    modulePreload: false,
    chunkSizeWarningLimit: 1000,
    rollupOptions: { output: { format: 'iife', entryFileNames: 'prototype.js', assetFileNames: '[name][extname]' } },
  },
});
let html = await fs.readFile(path.join(target, '.build/index.html'), 'utf8');
const js = await fs.readFile(path.join(target, '.build/prototype.js'), 'utf8');
const cssName = (await fs.readdir(path.join(target, '.build'))).find(name => name.endsWith('.css'));
const css = (cssName ? await fs.readFile(path.join(target, '.build', cssName), 'utf8') : '') + '\n' + await fs.readFile(path.join(tools, 'demo.css'), 'utf8');
const favicon = await fs.readFile(path.join(source, 'client/public/favicon.svg'), 'utf8');
html = html
  .replace(/<script\b[^>]*\bsrc=["'][^"']+["'][^>]*><\/script>/g, '')
  .replace(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/g, '')
  .replace(/<link\b[^>]*\brel=["']icon["'][^>]*>/g, () => `<link rel="icon" href="data:image/svg+xml;base64,${Buffer.from(favicon).toString('base64')}" />`)
  .replace('</head>', () => `<style>${css.replaceAll('</style', '<\\/style')}</style></head>`)
  .replace('</body>', () => `<script>${js.replaceAll('</script', '<\\/script')}</script></body>`)
  .replace('<title>NRI Connect 24/7 | Local support from anywhere</title>', '<title>NRI Connect 24/7 | Interactive prototype</title>');
await fs.writeFile(path.join(target, 'index.html'), html, 'utf8');
console.log(`Created ${path.join(target, 'index.html')} (${Math.round(Buffer.byteLength(html) / 1024)} KB). No server or external assets required.`);
