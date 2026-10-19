const fs = require('node:fs');
const path = require('node:path');
const { X509Certificate } = require('node:crypto');
const selfsigned = require('selfsigned');

async function identity(dir) {
  const tlsDir = path.join(dir, 'tls');
  fs.mkdirSync(tlsDir, { recursive: true, mode: 0o700 });
  const pem = path.join(tlsDir, 'shim-synergy.pem');
  if (!fs.existsSync(pem)) {
    const cert = await selfsigned.generate([{ name: 'commonName', value: 'Shim Synergy local device' }], {
      keySize: 2048, algorithm: 'sha256', notBeforeDate: new Date(Date.now() - 300000),
      notAfterDate: new Date(Date.now() + 3650 * 86400000),
      extensions: [{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, keyEncipherment: true }, { name: 'extKeyUsage', serverAuth: true, clientAuth: true }]
    });
    fs.writeFileSync(pem, cert.private + cert.cert, { mode: 0o600, flag: 'wx' });
  }
  const content = fs.readFileSync(pem, 'utf8');
  const cert = new X509Certificate(content);
  return { pem, key: content, cert: cert.toString(), fingerprint: cert.fingerprint256.replace(/:/g, '').toLowerCase() };
}
function writeTrust(dir, fingerprint) {
  if (!/^[a-f0-9]{64}$/i.test(fingerprint)) throw new Error('인증서 지문이 올바르지 않습니다.');
  fs.mkdirSync(path.join(dir, 'tls'), { recursive: true, mode: 0o700 });
  for (const name of ['trusted-servers', 'trusted-clients']) fs.writeFileSync(path.join(dir, 'tls', name), `v2:sha256:${fingerprint.toLowerCase()}\n`, { mode: 0o600 });
}
module.exports = { identity, writeTrust };
