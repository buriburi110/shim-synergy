const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const version = '1.27.0';
const assets = {
  'win32-x64': ['deskflow-1.27.0-win-x64-portable.zip', '8d19004cc3625623489d96580c1b58fd13ee78185689907fd4478595f93fab9a'],
  'darwin-arm64': ['deskflow-1.27.0-macos-arm64.dmg', 'dd21e79e566314394214906d3338c505d337af536fc580c022ee3fadffad0c97'],
  'darwin-x64': ['deskflow-1.27.0-macos-x86_64.dmg', '8aca3c77a1b16b9a3d6b8a380e5e38a0e6abf6d241bb32dcf3cf8b67abbff5d8']
};
async function download(url, file) {
  const response = await fetch(url); if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
}
async function main() {
  const arch = process.argv[2] || process.arch;
  const key = `${process.platform}-${arch}`, asset = assets[key];
  if (!asset) throw new Error(`지원하지 않는 빌드 환경: ${key}`);
  const destination = path.join(root, 'engine', `${process.platform === 'win32' ? 'win' : 'mac'}-${arch}`);
  fs.mkdirSync(destination, { recursive: true });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'shim-synergy-build-'));
  const archive = path.join(temp, asset[0]);
  await download(`https://github.com/deskflow/deskflow/releases/download/v${version}/${asset[0]}`, archive);
  const hash = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  if (hash !== asset[1]) throw new Error('입력 공유 엔진의 SHA-256 검증에 실패했습니다.');
  if (process.platform === 'win32') {
    execFileSync('tar.exe', ['-xf', archive, '-C', temp]);
    const extracted = path.join(temp, `deskflow-${version}-win-x64-portable`);
    fs.cpSync(extracted, destination, { recursive: true });
  } else {
    const mount = path.join(temp, 'mounted'); fs.mkdirSync(mount);
    execFileSync('hdiutil', ['attach', archive, '-readonly', '-nobrowse', '-mountpoint', mount]);
    try {
      const bundle = fs.readdirSync(mount).find(name => name.toLowerCase().endsWith('.app'));
      if (!bundle) throw new Error('DMG에서 앱을 찾지 못했습니다.');
      execFileSync('ditto', [path.join(mount, bundle), path.join(destination, 'Deskflow.app')]);
    } finally { execFileSync('hdiutil', ['detach', mount]); }
  }
  fs.writeFileSync(path.join(destination, 'UPSTREAM.json'), JSON.stringify({ project: 'Deskflow', version, source: 'https://github.com/deskflow/deskflow/tree/v1.27.0', asset: asset[0], sha256: hash }, null, 2));
  console.log(`엔진 준비 완료: ${key}, SHA-256 ${hash}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
