import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checks = path.join(target, '.checks');
await fs.mkdir(checks, { recursive: true });
const profile = path.join(checks, `profile-${Date.now()}`);
await fs.mkdir(profile);
const server = http.createServer(async (_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(await fs.readFile(path.join(target, 'index.html')));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const webUrl = `http://127.0.0.1:${server.address().port}/nri-connect-demo/`;
const browser = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
browser.on('error', error => { console.error(error); process.exitCode = 1; });
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let socket;
let send;
const errors = [];
const network = [];
try {
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await pause(100); }
  }
  if (!port) throw new Error('Headless browser did not start.');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject); });
  let sequence = 0;
  const pending = new Map();
  send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 30000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const promise = pending.get(message.id); pending.delete(message.id); clearTimeout(promise.timer);
      message.error ? promise.reject(new Error(message.error.message)) : promise.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(arg => arg.description || arg.value).join(' '));
    if (message.method === 'Network.requestWillBeSent') network.push(message.params.request.url);
  });
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async expression => {
    for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(expression)) return; await pause(100); }
    throw new Error(`Condition did not become true: ${expression}\n${await evaluate('document.body.innerText.slice(0, 1000)')}`);
  };
  const screenshot = async name => {
    const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await fs.writeFile(path.join(checks, name), Buffer.from(result.data, 'base64'));
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: webUrl });
  await waitFor('!!globalThis.NRI_DEMO && !!document.querySelector("#demo-persona")');
  await evaluate('NRI_DEMO.ready');
  await waitFor('document.querySelector("#demo-persona").options.length > 2');
  await screenshot('landing-desktop.png');
  console.log('HTTP subdirectory: landing and demo initialization passed.');
  console.log(await evaluate('JSON.stringify({title:document.title,users:document.querySelector("#demo-persona").options.length-1,body:document.body.innerText.slice(0,220)})'));

  if (process.argv.includes('--full')) {
    const test = await fs.readFile(path.join(target, 'tools/workflow-check.js'), 'utf8');
    console.log(await evaluate(test));
    const savedId = await evaluate('globalThis.__nriPersistenceId');
    await send('Page.reload');
    await waitFor('!!globalThis.NRI_DEMO && !!document.querySelector("#demo-persona")');
    const restored = await evaluate(`(async()=>{await NRI_DEMO.ready;return (await NRI_DEMO.store.get('service_requests',${JSON.stringify(savedId)}))?.status;})()`);
    if (restored !== 'closed') throw new Error('Saved request did not survive browser reload.');
    console.log('Browser reload: saved workflow data persisted.');
  }

  await evaluate(`(async()=>{await NRI_DEMO.reset();const users=await NRI_DEMO.users();const select=document.querySelector('#demo-persona');select.value=users.find(u=>u.email==='customer@ppo.test').id;select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor('location.hash.includes("/app/overview") && !!document.querySelector("main .metric")');
  await screenshot('customer-desktop.png');
  console.log('Customer role switch and dashboard passed.');

  if (process.argv.includes('--full')) {
    await evaluate(`location.hash='/app/properties/new'`);
    await waitFor('!!document.querySelector("main form") && document.querySelector("main").innerText.includes("Property name")');
    for (const [label, value] of [['Property name', 'Property created through the UI'], ['Address line 1', '123 Prototype Road'], ['City', 'Chennai'], ['State', 'Tamil Nadu'], ['PIN code', '600020']]) {
      await evaluate(`(()=>{const label=[...document.querySelectorAll('main label')].find(item=>item.textContent.startsWith(${JSON.stringify(label)}));const input=document.getElementById(label.htmlFor);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await pause(40);
    }
    await evaluate(`document.querySelector('main form').requestSubmit()`);
    await waitFor('!location.hash.endsWith("/new") && document.querySelector("main").innerText.includes("Property created through the UI")');
    console.log('React property form submission passed.');
    console.log(await evaluate(`(async()=>{const id=location.hash.split('/').pop();const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const form=new FormData();form.append('files',blob,'xhr-proof.png');return await new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST','/api/v1/properties/'+id+'/attachments');xhr.onload=()=>xhr.status===201?resolve('XHR file upload widget transport passed.'):reject(new Error(xhr.responseText));xhr.onerror=()=>reject(new Error('XHR upload failed.'));xhr.send(form);});})()`));
    const rolesAndRoutes = [
      ['customer@ppo.test', ['/app/overview','/app/properties','/app/travel','/app/travel/new','/app/representatives','/app/requests','/app/requests/new','/app/notifications','/app/profile']],
      ['super@ppo.test', ['/app/admin','/app/admin/requests','/app/admin/users','/app/admin/categories','/app/admin/audit','/app/admin/outbox','/app/admin/settings','/app/properties/new']],
      ['engineer@ppo.test', ['/app/jobs']],
      ['travel@ppo.test', ['/app/travel-cases']],
      ['rep@ppo.test', ['/app/shared']],
    ];
    let routeCount = 0;
    for (const [email, routes] of rolesAndRoutes) {
      await evaluate(`(async()=>{const users=await NRI_DEMO.users();const select=document.querySelector('#demo-persona');select.value=users.find(user=>user.email===${JSON.stringify(email)}).id;select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await pause(100);
      for (const route of routes) {
        await evaluate(`location.hash=${JSON.stringify(route)}`);
        await waitFor('!!document.querySelector("main h1") && !document.querySelector("main [aria-busy=true]")');
        await pause(70);
        const body = await evaluate('document.querySelector("main").innerText');
        if (/Something went wrong|The demo action could not be saved|This demo page or action was not found/.test(body)) throw new Error(`Page failed: ${email} ${route}\n${body}`);
        routeCount++;
      }
    }
    console.log(`${routeCount} role-specific pages rendered successfully.`);
    await evaluate(`(async()=>{const users=await NRI_DEMO.users();const select=document.querySelector('#demo-persona');select.value=users.find(user=>user.email==='customer@ppo.test').id;select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await waitFor('location.hash.includes("/app/overview") && !!document.querySelector("main .metric")');
  }

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await pause(400);
  await screenshot('customer-mobile.png');
  console.log('Mobile layout:', await evaluate('JSON.stringify({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,sidebar:getComputedStyle(document.querySelector(".side")).transform})'));
  await evaluate(`document.querySelector('[aria-label="Open menu"]').click()`);
  await waitFor('!!document.querySelector(".side.open")');
  await evaluate(`document.querySelector('[aria-label="Close menu"]').click()`);
  await waitFor('!document.querySelector(".side.open")');
  console.log('Mobile navigation opens and closes.');

  await send('Page.navigate', { url: pathToFileURL(path.join(target, 'index.html')).href });
  await waitFor('!!globalThis.NRI_DEMO && !!document.querySelector("#demo-persona")');
  await evaluate('NRI_DEMO.ready');
  await waitFor('document.querySelector("#demo-persona").options.length > 2');
  await evaluate(`(async()=>{const users=await NRI_DEMO.users();const select=document.querySelector('#demo-persona');select.value=users.find(user=>user.email==='customer@ppo.test').id;select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor('location.hash.includes("/app/overview") && !!document.querySelector("main .metric")');
  console.log('Direct file:// launch passed.');
  const external = network.filter(url => /^https?:/.test(url) && !url.startsWith('http://127.0.0.1:'));
  if (external.length) throw new Error(`Unexpected external dependencies: ${external.join(', ')}`);
  if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`);
  console.log('No browser console errors or external application requests.');
  await fs.writeFile(path.join(checks, 'result.json'), JSON.stringify({ success: true, externalRequests: external, errors, checkedAt: new Date().toISOString() }, null, 2));
} finally {
  if (send && socket?.readyState === WebSocket.OPEN) {
    await send('Browser.close').catch(() => {}); socket.close();
  } else browser.kill();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
