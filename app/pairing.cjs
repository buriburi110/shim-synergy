const https = require('node:https');
const tls = require('node:tls');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { validName, validHost, sameSubnet } = require('./model.cjs');

function decodeCode(code) {
  if (typeof code !== 'string' || code.length > 4096 || !code.trim().startsWith('SHIM1.')) throw new Error('맥에서 복사한 연결 코드를 붙여 넣어 주세요.');
  let data;
  try { data = JSON.parse(Buffer.from(code.trim().slice(6), 'base64url').toString()); } catch { throw new Error('연결 코드 형식이 올바르지 않습니다.'); }
  if (!validHost(data.host) || !validName(data.name) || !/^[a-f0-9]{64}$/i.test(data.fingerprint) || !/^[a-f0-9]{64}$/i.test(data.token) || !Number.isInteger(data.port) || data.port < 1024 || data.port > 65535 || !Number.isFinite(data.expires) || data.expires < Date.now() || data.expires > Date.now() + 660000) throw new Error('만료되었거나 올바르지 않은 코드입니다. 맥에서 새 코드를 만들어 주세요.');
  return data;
}
class PairingServer extends EventEmitter {
  constructor(id, options) { super(); this.id = id; this.options = options; this.pending = null; }
  async open(host, port) {
    await this.close();
    this.token = randomBytes(32).toString('hex'); this.expires = Date.now() + 600000;
    this.server = https.createServer({ key: this.id.key, cert: this.id.cert, minVersion: 'TLSv1.2', requestTimeout: 100000 }, (req, res) => this.handle(req, res));
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(port, this.options.bind || '0.0.0.0', resolve); });
    const actualPort = this.server.address().port;
    this.timer = setTimeout(() => this.close(), 600000).unref();
    this.code = 'SHIM1.' + Buffer.from(JSON.stringify({ host, port: actualPort, token: this.token, expires: this.expires, name: this.options.name, fingerprint: this.id.fingerprint, position: this.options.position })).toString('base64url');
    return this.code;
  }
  handle(req, res) {
    const remote = req.socket.remoteAddress.replace(/^::ffff:/, '');
    if (!sameSubnet(remote)) { res.writeHead(403).end('same subnet required'); return; }
    if (req.method === 'GET' && req.url === '/hello' && Date.now() < this.expires && this.token) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ code: this.code, fingerprint: this.id.fingerprint })); return;
    }
    if (req.method !== 'POST' || req.url !== '/pair') { res.writeHead(404).end(); return; }
    const supplied = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
    const expected = Buffer.from(this.token || '');
    if (Date.now() > this.expires || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.writeHead(403).end('invalid pairing token'); return; }
    if (this.pending) { res.writeHead(409).end('a pairing request is already pending'); return; }
    let body = ''; let oversized = false;
    req.on('data', chunk => { body += chunk; if (body.length > 8192) { oversized = true; res.writeHead(413).end(); req.destroy(); } });
    req.on('end', () => {
      if (oversized) return;
      let peer;
      try { peer = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
      if (!validName(peer.name) || peer.name === this.options.name || !/^[a-f0-9]{64}$/i.test(peer.fingerprint) || !['darwin', 'win32'].includes(peer.platform)) { res.writeHead(400).end('invalid device'); return; }
      const host = req.socket.remoteAddress.replace(/^::ffff:/, '');
      if (!validHost(host)) { res.writeHead(400).end(); return; }
      const requestId = randomBytes(12).toString('hex');
      const timer = setTimeout(() => { if (this.pending?.id === requestId) this.respond(requestId, false); }, 85000).unref();
      this.pending = { id: requestId, peer: { ...peer, host }, res, timer };
      res.on('close', () => { if (this.pending?.id === requestId) { clearTimeout(timer); this.pending = null; this.emit('pending', null); } });
      this.emit('pending', { id: requestId, peer: this.pending.peer });
    });
  }
  respond(id, approved) {
    if (!this.pending || this.pending.id !== id) throw new Error('연결 요청이 만료됐습니다.');
    const pending = this.pending;
    this.pending = null; clearTimeout(pending.timer);
    if (!approved) { pending.res.writeHead(403).end('연결이 거절됐습니다.'); this.emit('pending', null); return; }
    this.emit('approved', pending.peer);
    pending.res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ name: this.options.name, platform: this.options.platform || 'darwin', fingerprint: this.id.fingerprint, position: this.options.position, port: this.options.enginePort }));
    this.token = ''; this.emit('pending', null);
    setTimeout(() => this.close(), 500).unref();
  }
  async close() {
    clearTimeout(this.timer);
    if (this.pending) this.respond(this.pending.id, false);
    const server = this.server; this.server = null; this.token = '';
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
}
function discoverPeer(host, port = 24801) {
  if (!validHost(host) || !sameSubnet(host)) throw new Error('이 컴퓨터와 같은 네트워크 대역의 IPv4 주소를 입력해 주세요.');
  return new Promise((resolve, reject) => {
    const req = https.get({ host, port, path: '/hello', rejectUnauthorized: false, timeout: 6000 }, res => {
      const actualFingerprint = res.socket.getPeerCertificate()?.fingerprint256?.replace(/:/g, '').toLowerCase();
      let body = ''; res.on('data', c => { body += c; if (body.length > 8192) req.destroy(new Error('상대 컴퓨터 응답이 올바르지 않습니다.')); });
      res.on('end', () => { try {
        if (res.statusCode !== 200) throw new Error('상대 컴퓨터에서 ‘연결 받기’를 눌러 주세요.');
        const data = JSON.parse(body); const code = decodeCode(data.code);
        if (data.fingerprint !== actualFingerprint) throw new Error('상대 인증서 정보가 일치하지 않습니다.');
        // Use the address the user entered, even on a computer with several adapters.
        code.host = host;
        resolve({ code: 'SHIM1.' + Buffer.from(JSON.stringify(code)).toString('base64url'), fingerprint: code.fingerprint, name: code.name });
      } catch (error) { reject(error); } });
    });
    req.once('timeout', () => req.destroy(new Error('응답이 없습니다. IP 주소·방화벽과 상대 앱의 연결 대기 상태를 확인해 주세요.')));
    req.once('error', reject);
  });
}
function requestPair(code, id, device, timeout = 90000) {
  const data = decodeCode(code);
  const agent = new https.Agent();
  // Hand the socket to HTTPS only after the certificate matches the code.
  agent.createConnection = (options, callback) => {
    const socket = tls.connect({ host: data.host, port: data.port, rejectUnauthorized: false, minVersion: 'TLSv1.2' });
    let settled = false;
    const finish = (error) => { if (settled) return; settled = true; if (error) { socket.destroy(); callback(error); } else callback(null, socket); };
    socket.once('error', finish);
    socket.once('secureConnect', () => {
      const fp = socket.getPeerCertificate().fingerprint256?.replace(/:/g, '').toLowerCase();
      finish(fp === data.fingerprint ? null : new Error('맥의 인증서가 연결 코드와 다릅니다. 새 코드로 다시 시도해 주세요.'));
    });
  };
  return new Promise((resolve, reject) => {
    const req = https.request({ host: data.host, port: data.port, method: 'POST', path: '/pair', agent,
      headers: { Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/json' }, timeout }, res => {
      let body = ''; res.on('data', c => { body += c; if (body.length > 8192) req.destroy(new Error('연결 응답이 너무 큽니다.')); });
      res.on('end', () => {
        agent.destroy();
        if (res.statusCode !== 200) { reject(new Error(res.statusCode === 403 ? '맥에서 연결을 허용해 주세요. 코드가 만료되었다면 새로 만들어 주세요.' : `연결 요청 실패 (${res.statusCode})`)); return; }
        try { const peer = JSON.parse(body); if (peer.fingerprint !== data.fingerprint || peer.name !== data.name || !['darwin','win32'].includes(peer.platform) || !Number.isInteger(peer.port) || peer.port < 1024 || peer.port > 65534 || !['left','right','above','below'].includes(peer.position)) throw new Error('연결 응답이 올바르지 않습니다.'); resolve({ ...peer, host: data.host }); } catch (e) { reject(e); }
      });
    });
    req.once('timeout', () => req.destroy(new Error('연결 시간이 초과됐습니다. 같은 네트워크인지, 맥에서 요청을 허용했는지 확인해 주세요.')));
    req.once('error', error => { agent.destroy(); reject(error); });
    req.end(JSON.stringify({ name: device.name, platform: device.platform, fingerprint: id.fingerprint }));
  });
}
module.exports = { PairingServer, requestPair, decodeCode, discoverPeer };
