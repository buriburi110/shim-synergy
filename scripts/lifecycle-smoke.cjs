const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

// Exercise the real main process in its own profile without touching a saved peer.
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'shim-lifecycle-')));
require('../app/main.cjs');
const timeout = setTimeout(()=>{console.error('FAIL: application lifecycle timed out');app.exit(1);},20000);
async function until(predicate) {
  const deadline=Date.now()+8000;
  while(Date.now()<deadline) { if(predicate()) return; await new Promise(resolve=>setTimeout(resolve,25)); }
  throw new Error('Application did not reach the expected window state');
}
async function main() {
  try {
    await app.whenReady();
    await until(()=>BrowserWindow.getAllWindows().some(win=>!win.webContents.isLoading()));
    const first=BrowserWindow.getAllWindows()[0];
    assert.equal(first.getTitle(),'시너지 · 심현규님의 책상');
    first.close();
    assert.equal(first.isDestroyed(),false,'Closing an idle workspace must preserve a reopenable tray window');
    assert.equal(first.isVisible(),false);
    app.emit('activate');
    await until(()=>first.isVisible());
    first.destroy();
    app.emit('activate');
    await until(()=>BrowserWindow.getAllWindows().some(win=>!win.webContents.isLoading() && win.isVisible()));
    const recreated=BrowserWindow.getAllWindows()[0];
    assert.notEqual(recreated.id,first.id);
    recreated.minimize();
    app.emit('second-instance',{},[],process.cwd());
    await until(()=>!recreated.isMinimized() && recreated.isVisible());
    console.log('PASS: idle close, tray-style reopen, destroyed-window recovery, and second-instance restore');
    clearTimeout(timeout); app.quit();
  } catch(error) { console.error(error.stack);clearTimeout(timeout);app.exit(1); }
}
main();
