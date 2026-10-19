const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const arch = process.argv[2] || process.arch;
const platform = process.platform === 'win32' ? 'win' : 'mac';
const root = path.resolve(__dirname, '..', 'engine', `${platform}-${arch}`);
const binary = platform === 'win' ? path.join(root, 'deskflow-core.exe') : path.join(root, 'Deskflow.app', 'Contents', 'MacOS', 'deskflow-core');
if (!fs.existsSync(binary) || fs.statSync(binary).size < 100000) throw new Error('패키지에 입력 공유 엔진이 없습니다.');
if (platform === 'mac') {
  const architectures = execFileSync('lipo',['-archs',binary],{encoding:'utf8'}).trim();
  const expected = arch === 'x64' ? 'x86_64' : 'arm64';
  if (!architectures.split(/\s+/).includes(expected)) throw new Error(`엔진 CPU 불일치: ${architectures}, expected ${expected}`);
  console.log(`엔진 CPU 확인: ${architectures}`);
}
if (arch === process.arch) console.log(execFileSync(binary,['--version'],{encoding:'utf8',timeout:15000}));
console.log(`입력 공유 엔진 검증 통과: ${platform}-${arch}`);
