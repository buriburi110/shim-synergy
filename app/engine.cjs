const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { serverConfig, engineSettings, logState } = require('./model.cjs');
const { writeTrust } = require('./identity.cjs');

class Engine extends EventEmitter {
  constructor(dir, executable, id) { super(); this.dir = dir; this.executable = executable; this.id = id; this.status = 'idle'; this.logs = []; }
  setStatus(status) { this.status = status; this.emit('status', status); }
  log(line) {
    this.logs.push({ at: new Date().toISOString(), text: line });
    this.logs = this.logs.slice(-120);
    const next = this.child ? logState(line, this.status) : this.status; if (next !== this.status) this.setStatus(next);
    this.emit('log', this.logs.at(-1));
  }
  async start(settings, options = {}) {
    await this.stop();
    if (!settings.peer) throw new Error('먼저 맥과 윈도우를 연결해 주세요.');
    if (!this.executable || !fs.existsSync(this.executable)) throw new Error('입력 공유 엔진을 찾지 못했습니다. 앱의 엔진 준비 상태를 확인해 주세요.');
    const server = path.join(this.dir, 'server.conf'); const config = path.join(this.dir, 'Deskflow.conf');
    fs.writeFileSync(server, serverConfig(settings), { mode: 0o600 });
    fs.writeFileSync(config, engineSettings(settings, { server, pem: this.id.pem, bind: options.bind }), { mode: 0o600 });
    writeTrust(this.dir, settings.peer.fingerprint);
    this.setStatus('starting');
    const args = [settings.role, '--settings', config, ...(options.multi ? ['--new-instance'] : [])];
    const child = spawn(this.executable, args, { windowsHide: true, cwd: path.dirname(this.executable), stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    for (const stream of [child.stdout, child.stderr]) {
      let pending = ''; stream.setEncoding('utf8');
      stream.on('data', chunk => { pending += chunk; const lines = pending.split(/\r?\n/); pending = lines.pop(); lines.filter(Boolean).forEach(line => this.log(line)); });
      stream.on('end', () => { if (pending) this.log(pending); });
    }
    child.once('error', error => { this.log(error.message); if (this.child === child) { this.child = null; this.setStatus('error'); } });
    child.once('exit', (code, signal) => { if (this.child === child) { this.child = null; this.log(`엔진 종료 (${code ?? signal})`); this.setStatus(code === 0 ? 'idle' : 'error'); } });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  }
  async stop() {
    const child = this.child;
    if (!child) { this.setStatus('idle'); return; }
    this.child = null;
    await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3500).unref();
      child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill();
    });
    this.setStatus('idle');
  }
}
module.exports = { Engine };
