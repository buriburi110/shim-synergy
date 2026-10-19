const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { identity, writeTrust } = require('../app/identity.cjs');
const { PairingServer, requestPair, decodeCode, discoverPeer } = require('../app/pairing.cjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'shim-pair-tests-'));
let serverId, clientId;
before(async () => { serverId = await identity(path.join(temp,'server')); clientId = await identity(path.join(temp,'client')); });
const device = {name:'shim-windows',platform:'win32'};
function server() { return new PairingServer(serverId, {name:'shim-mac',position:'right',enginePort:24800,bind:'127.0.0.1'}); }
test('certificate identity persists and is compatible with Deskflow SHA-256 trust files', async () => {
  assert.equal((await identity(path.join(temp,'server'))).fingerprint,serverId.fingerprint);
  assert.notEqual(serverId.fingerprint,clientId.fingerprint);
  writeTrust(path.join(temp,'client'),serverId.fingerprint);
  assert.equal(fs.readFileSync(path.join(temp,'client','tls','trusted-servers'),'utf8'),`v2:sha256:${serverId.fingerprint}\n`);
});
test('IP discovery, certificate pinning, host approval, and one-time pairing work over real TLS', async () => {
  const s = server(); const code = await s.open('127.0.0.1',0);
  try {
    const data = decodeCode(code); const discovered = await discoverPeer('127.0.0.1',data.port);
    assert.equal(discovered.fingerprint,serverId.fingerprint);
    const approved = new Promise(resolve=>s.once('approved',resolve));
    s.once('pending',pending=>{ if(pending) s.respond(pending.id,true); });
    const result = await requestPair(discovered.code,clientId,device,3000);
    assert.equal(result.fingerprint,serverId.fingerprint); assert.equal(result.host,'127.0.0.1');
    const incoming = await approved; assert.equal(incoming.fingerprint,clientId.fingerprint);
    await assert.rejects(requestPair(code,clientId,device,3000));
  } finally { await s.close(); }
});
test('declining a request does not approve the device', async () => {
  const s = server(); const code = await s.open('127.0.0.1',0); let approved = false;
  s.on('approved',()=>approved=true); s.once('pending',pending=>{ if(pending) s.respond(pending.id,false); });
  try { await assert.rejects(requestPair(code,clientId,device,3000)); assert.equal(approved,false); } finally { await s.close(); }
});
test('wrong certificate pins are rejected before a pairing body can be sent', async () => {
  const s = server(); const code = await s.open('127.0.0.1',0); let reached = false;
  s.on('pending',p=>{ if(p) reached=true; });
  try {
    const data = decodeCode(code); data.fingerprint='f'.repeat(64);
    await assert.rejects(requestPair('SHIM1.'+Buffer.from(JSON.stringify(data)).toString('base64url'),clientId,device,3000),/인증서/);
    assert.equal(reached,false);
  } finally { await s.close(); }
});
test('expired codes and oversized input fail before network access', () => {
  assert.throws(()=>decodeCode('SHIM1.'+'A'.repeat(5000)));
  const code={host:'127.0.0.1',name:'shim-mac',fingerprint:'a'.repeat(64),token:'b'.repeat(64),port:24801,expires:Date.now()-1};
  assert.throws(()=>decodeCode('SHIM1.'+Buffer.from(JSON.stringify(code)).toString('base64url')));
});
test('stopping the pairing listener rejects a waiting request and releases its port', async () => {
  const s=server(); const code=await s.open('127.0.0.1',0);
  const arrived=new Promise(resolve=>s.once('pending',p=>{if(p) resolve();}));
  const outcome=requestPair(code,clientId,device,3000).then(()=>false,()=>true);
  await arrived; await s.close(); assert.equal(await outcome,true); assert.equal(s.pending,null);
});
