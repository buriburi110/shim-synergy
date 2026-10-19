const { app, BrowserWindow, ipcMain, shell, clipboard, Menu, Tray, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { defaults, validateSettings, networkAddresses, validHost } = require('./model.cjs');
const { identity } = require('./identity.cjs');
const { PairingServer, requestPair, discoverPeer } = require('./pairing.cjs');
const { Engine } = require('./engine.cjs');
const { findEngine } = require('./paths.cjs');

app.setName('Shim Synergy');
if (!app.requestSingleInstanceLock()) { app.quit(); } else {
  let window, tray, engine, id, pairing, settings, dataDir, pending = null, receivedCode = null, pairingExpires = null;
  let preparing = false, quitting = false, error = null;
  const configFile = () => path.join(dataDir, 'preferences.json');
  function save() { fs.writeFileSync(configFile() + '.tmp', JSON.stringify(settings, null, 2), { mode: 0o600 }); fs.renameSync(configFile() + '.tmp', configFile()); }
  function state() { return { settings, platform: process.platform, addresses: networkAddresses(), status: engine?.status || 'idle', engineReady: !!engine?.executable, preparing, fingerprint: id?.fingerprint, pending, pairingExpires, error, logs: engine?.logs || [], version: app.getVersion(), preview: false }; }
  function broadcast() { if (window && !window.isDestroyed()) window.webContents.send('state', state()); }
  async function showWindow() {
    if (quitting) return;
    if (!window || window.isDestroyed()) await createWindow();
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
  }
  function reopen() { showWindow().catch(e => { error = e.message; broadcast(); }); }
  async function stopSharing() {
    try { await engine.stop(); }
    finally { if (pairing) await pairing.close(); pairingExpires = null; broadcast(); }
  }
  function handle(name, action) {
    ipcMain.handle(name, async (event, ...args) => {
      if (event.sender !== window?.webContents || !event.senderFrame.url.startsWith('file://')) throw new Error('접근할 수 없는 창입니다.');
      try { error = null; const result = await action(...args); broadcast(); return { ok: true, value: result }; }
      catch (e) { error = e.message; broadcast(); return { ok: false, error: e.message }; }
    });
  }
  async function openPairing() {
    if (settings.role !== 'server') throw new Error('먼저 ‘이 컴퓨터의 키보드로 조작’을 선택해 주세요.');
    const address = networkAddresses()[0]?.address;
    if (!address) throw new Error('네트워크 연결을 확인해 주세요.');
    if (pairing) await pairing.close();
    pairing = new PairingServer(id, { name: settings.name, platform: process.platform, position: settings.position, enginePort: settings.port });
    const activePairing = pairing;
    pairing.on('closed', () => { if (pairing === activePairing) { pairingExpires = null; broadcast(); } });
    pairing.on('pending', value => { pending = value; broadcast(); });
    pairing.on('approved', peer => {
      settings.peer = peer; save();
      engine.start(settings).catch(e => { error = e.message; broadcast(); });
    });
    const code = await pairing.open(address, settings.port + 1);
    pairingExpires = Date.now() + 600000;
    broadcast(); return code;
  }
  async function createWindow() {
    window = new BrowserWindow({ width: 1320, height: 900, minWidth: 1050, minHeight: 760, title: '시너지 · 심현규님의 책상', backgroundColor: '#f5f6f4',
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    await window.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
    window.on('close', event => { if (!quitting && tray) { event.preventDefault(); window.hide(); } });
  }
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    dataDir = path.join(app.getPath('userData'), 'local'); fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    settings = defaults();
    try { if (fs.existsSync(configFile())) settings = validateSettings({ ...settings, ...JSON.parse(fs.readFileSync(configFile(), 'utf8')) }); } catch { error = '저장된 설정을 읽을 수 없어 기본값으로 시작했습니다.'; }
    id = await identity(dataDir);
    engine = new Engine(dataDir, findEngine(app), id);
    engine.on('status', broadcast); engine.on('log', broadcast);
    handle('state:get', state);
    handle('settings:save', async value => {
      const allowed = ['name','role','position','clipboard','swapModifiers'];
      const next = { ...settings }; for (const key of allowed) if (Object.hasOwn(value, key)) next[key] = value[key];
      if (next.role !== settings.role || next.name !== settings.name) next.peer = null;
      validateSettings(next); const wasRunning = !!engine.child; await engine.stop();
      if (pairing) { await pairing.close(); pairingExpires = null; }
      settings = next; save(); if (wasRunning && settings.peer) await engine.start(settings); return state();
    });
    handle('pair:open', openPairing);
    handle('pair:discover', async host => { receivedCode = await discoverPeer(String(host).trim(), settings.port + 1); return receivedCode; });
    handle('pair:connect', async () => {
      if (!receivedCode) throw new Error('먼저 상대 컴퓨터 IP를 확인해 주세요.');
      const peer = await requestPair(receivedCode.code, id, { name: settings.name, platform: process.platform });
      settings.role = 'client'; settings.peer = peer; settings.position = peer.position; settings.port = peer.port;
      validateSettings(settings); save(); receivedCode = null; await engine.start(settings); return state();
    });
    handle('pair:respond', async (requestId, approved) => { pairing.respond(requestId, approved === true); return state(); });
    handle('engine:start', async () => { await engine.start(settings); return state(); });
    handle('engine:stop', async () => { await stopSharing(); return state(); });
    handle('peer:forget', async () => { await engine.stop(); if (pairing) await pairing.close(); settings.peer = null; save(); return state(); });
    handle('address:update', async host => {
      if (!settings.peer || !validHost(host)) throw new Error('올바른 컴퓨터 주소를 입력해 주세요.');
      settings.peer.host = host; save(); if (engine.child) await engine.start(settings); return state();
    });
    handle('clipboard:copy', text => { if (typeof text !== 'string' || text.length > 8192) throw new Error('복사할 수 없는 내용입니다.'); clipboard.writeText(text); });
    handle('system:settings', async kind => {
      if (process.platform === 'darwin') await shell.openExternal(kind === 'input' ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent' : 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
      else if (kind === 'firewall') await shell.openExternal('ms-settings:network-status');
    });
    handle('logs:open', async () => { const file = path.join(dataDir, 'diagnostics.txt'); fs.writeFileSync(file, engine.logs.map(l => `${l.at} ${l.text}`).join('\n')); await shell.openPath(file); });
    await createWindow();
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', 'ui', 'icon.png')).resize({ width: 22, height: 22 }));
    tray.setToolTip('시너지 · 심현규님의 책상'); tray.setContextMenu(Menu.buildFromTemplate([{ label: '책상 열기', click: reopen }, { label: '연결 중지', click: () => stopSharing().catch(e => { error = e.message; broadcast(); }) }, { type: 'separator' }, { label: '종료', click: () => app.quit() }]));
    tray.on('click', reopen);
  }).catch(e => { console.error(e); app.quit(); });
  app.on('second-instance', reopen);
  app.on('activate', reopen);
  app.on('window-all-closed', () => { if (!tray) app.quit(); });
  app.on('before-quit', event => {
    if (quitting) return; event.preventDefault(); quitting = true;
    Promise.allSettled([engine?.stop(), pairing?.close()]).finally(() => app.quit());
  });
}
