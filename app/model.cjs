const os = require('node:os');
const net = require('node:net');

const directions = { right: ['right', 'left'], left: ['left', 'right'], above: ['up', 'down'], below: ['down', 'up'] };
function defaults(platform = process.platform) {
  return { version: 1, owner: '심현규', platform, role: platform === 'darwin' ? 'server' : 'client',
    name: platform === 'darwin' ? 'shim-mac' : 'shim-windows', position: 'right', clipboard: true,
    swapModifiers: true, port: 24800, peer: null, autoLaunch: false };
}
function validName(value) { return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/.test(value); }
function validHost(value) {
  return typeof value === 'string' && value.length <= 253 && (net.isIP(value) === 4 || /^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(value));
}
function validateSettings(value) {
  if (!value || !validName(value.name)) throw new Error('컴퓨터 이름은 영문·숫자·점·밑줄·하이픈으로 63자 이내로 입력해 주세요.');
  if (!['server', 'client'].includes(value.role) || !directions[value.position]) throw new Error('컴퓨터 역할 또는 화면 배치를 확인해 주세요.');
  if (!Number.isInteger(value.port) || value.port < 1024 || value.port > 65534) throw new Error('연결 포트는 1024~65534 사이여야 합니다.');
  if (typeof value.clipboard !== 'boolean' || typeof value.swapModifiers !== 'boolean') throw new Error('공유 설정이 올바르지 않습니다.');
  if (value.peer && (!validName(value.peer.name) || value.peer.name === value.name || !/^[a-f0-9]{64}$/i.test(value.peer.fingerprint) || !validHost(value.peer.host))) throw new Error('다른 컴퓨터의 연결 정보가 올바르지 않습니다. 다시 연결해 주세요.');
  return value;
}
function networkAddresses() {
  const result = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const e of entries || []) if (e.family === 'IPv4' && !e.internal && !/^169\.254\./.test(e.address)) result.push({ name, address: e.address });
  }
  return result.sort((a, b) => Number(/vEthernet|Virtual|VMware|WSL/i.test(a.name)) - Number(/vEthernet|Virtual|VMware|WSL/i.test(b.name)));
}
function sameSubnet(address) {
  if (net.isIP(address) !== 4) return false;
  const integer = s => s.split('.').reduce((n, p) => (n << 8) | Number(p), 0) >>> 0;
  for (const entries of Object.values(os.networkInterfaces())) for (const item of entries || []) {
    if (item.family !== 'IPv4') continue;
    const mask = integer(item.netmask);
    if ((integer(address) & mask) === (integer(item.address) & mask)) return true;
  }
  return false;
}
function serverConfig(settings) {
  validateSettings(settings);
  if (!settings.peer) throw new Error('먼저 다른 컴퓨터를 연결해 주세요.');
  const serverName = settings.role === 'server' ? settings.name : settings.peer.name;
  const clientName = settings.role === 'client' ? settings.name : settings.peer.name;
  const serverIsMac = settings.role === 'server' ? settings.platform === 'darwin' : settings.peer.platform === 'darwin';
  const [out, back] = serverIsMac ? directions[settings.position] : [...directions[settings.position]].reverse();
  return `# Shim Synergy — generated for Deskflow 1.27\nsection: links\n  ${serverName}:\n    ${out} = ${clientName}\n  ${clientName}:\n    ${back} = ${serverName}\nend\n\nsection: options\nend\n`;
}
function ini(value) { return `"${String(value).replace(/\\/g, '/').replace(/"/g, '\\"')}"`; }
function engineSettings(settings, paths) {
  validateSettings(settings);
  const clientName = settings.role === 'client' ? settings.name : settings.peer?.name;
  const computers = [settings.name, settings.peer?.name].filter(Boolean).map(name => `[computer_${name}]\nname=${name}\n${name === clientName && settings.swapModifiers ? 'modifierSuper=ctrl\nmodifierCtrl=super\n' : ''}`).join('\n');
  return `[core]\ncomputerName=${settings.name}\nport=${settings.port}\nprocessMode=0\n${paths.bind ? `interface=${paths.bind}\n` : ''}\n[client]\nremoteHost=${settings.role === 'client' && settings.peer ? settings.peer.host : ''}\nlanguageSync=false\n\n[security]\ntlsEnabled=true\ncheckPeerFingerprints=true\ncertificate=${ini(paths.pem)}\n\n[server]\nexternalConfig=true\nexternalConfigFile=${ini(paths.server)}\nenableClipboard=${settings.clipboard}\nenableSwitchDelay=true\nswitchDelay=100\nprotocol=barrier\n\n[log]\nlevel=DEBUG\ntoFile=false\n\n${computers}`;
}
function logState(line, current = 'starting') {
  if (/disconnected|connection refused|failed to connect|connection timed out|server is not responding/i.test(line)) return 'reconnecting';
  if (/connected to server|client ".+" has connected/i.test(line)) return 'connected';
  if (/started server, waiting for clients/i.test(line)) return 'listening';
  if (/fingerprint does not match|failed to verify|accessibility.*(denied|not)|unable to.*(screen|display)|FATAL|CRITICAL/i.test(line)) return 'error';
  return current;
}
module.exports = { defaults, validName, validHost, validateSettings, serverConfig, engineSettings, networkAddresses, sameSubnet, logState };
