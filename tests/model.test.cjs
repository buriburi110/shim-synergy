const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaults, serverConfig, engineSettings, validateSettings, logState, sameSubnet } = require('../app/model.cjs');
test('macOS defaults to the controlling computer and Windows to the receiving computer', () => {
  assert.equal(defaults('darwin').role, 'server'); assert.equal(defaults('win32').role, 'client');
});
test('screen links are reciprocal in all four directions and clipboard changes reach core', () => {
  const dirs = {left:['left','right'],right:['right','left'],above:['up','down'],below:['down','up']};
  for (const [position, [out, back]] of Object.entries(dirs)) {
    const s = {...defaults('darwin'), position, peer:{name:'shim-windows',host:'192.168.0.2',fingerprint:'a'.repeat(64)},clipboard:false};
    const config = serverConfig(s);
    assert.match(config,new RegExp(`${out} = shim-windows`)); assert.match(config,new RegExp(`${back} = shim-mac`));
    assert.match(engineSettings(s,{pem:'a',server:'b'}),/enableClipboard=false/);
    assert.match(engineSettings(s,{pem:'a',server:'b'}),/\[computer_shim-windows\]\nname=shim-windows\nmodifierSuper=ctrl/);
    assert.match(engineSettings(s,{pem:'C:\\Users\\심현규\\tls.pem',server:'C:\\Users\\심현규\\server.conf'}),/tlsEnabled=true\ncheckPeerFingerprints=true/);
    assert.match(engineSettings(s,{pem:'a',server:'b'}),/protocol=barrier/);
  }
});
test('names cannot inject new configuration sections', () => {
  assert.throws(()=>validateSettings({...defaults(),name:'evil\n[security]'}));
  assert.throws(()=>validateSettings({...defaults(),peer:{name:'shim-mac',host:'127.0.0.1',fingerprint:'invalid'}}));
});
test('process existence and failed connection logs never imply a connected peer', () => {
  assert.equal(logState('started server, waiting for clients'), 'listening');
  assert.equal(logState('client "shim-windows" has connected'), 'connected');
  assert.equal(logState('disconnected from server','connected'), 'reconnecting');
  assert.equal(logState('connected to server'), 'connected');
  assert.equal(logState('fingerprint does not match trusted fingerprint','starting'), 'error');
  assert.equal(logState('connecting to 192.168.0.10','starting'), 'starting');
  assert.equal(sameSubnet('8.8.8.8'),false); assert.equal(sameSubnet('127.0.0.1'),true);
});
