const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { identity, writeTrust } = require('../app/identity.cjs');
const { defaults, serverConfig, engineSettings } = require('../app/model.cjs');
const { findEngine } = require('../app/paths.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(),'shim-native-smoke-'));
const children = [], evidence = { scope: 'Two native Deskflow processes on one Windows desktop, loopback-only TLS; no screen links and no generated input', logs: [] };
function start(role, dir, settings, id) {
  const config = path.join(dir,'Deskflow.conf'), server = path.join(dir,'server.conf');
  fs.writeFileSync(server, serverConfig(settings).replace(/section: links[\s\S]*?end\n/, 'section: links\nend\n'));
  fs.writeFileSync(config, engineSettings(settings,{pem:id.pem,server,bind:'127.0.0.1'}));
  writeTrust(dir,settings.peer.fingerprint);
  const child = spawn(findEngine({isPackaged:false}),[role,'--settings',config,'--new-instance'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  children.push(child);
  for(const stream of [child.stdout,child.stderr]) { stream.setEncoding('utf8'); stream.on('data',text=>evidence.logs.push({role,text})); }
  return child;
}
async function waitFor(role,regex) {
  const start = Date.now();
  while(Date.now()-start<14000) {
    if(evidence.logs.some(l=>l.role===role && regex.test(l.text))) return;
    await new Promise(r=>setTimeout(r,100));
  }
  throw new Error(`Native ${role} did not reach ${regex}`);
}
async function main() {
  try {
    const serverDir=path.join(root,'server'),clientDir=path.join(root,'client');
    const serverId=await identity(serverDir),clientId=await identity(clientDir);
    const server={...defaults('darwin'),port:39847,peer:{name:'shim-windows',platform:'win32',host:'127.0.0.1',fingerprint:clientId.fingerprint}};
    const client={...defaults('win32'),port:39847,peer:{name:'shim-mac',platform:'darwin',host:'127.0.0.1',fingerprint:serverId.fingerprint}};
    start('server',serverDir,server,serverId); await waitFor('server',/started server, waiting for clients/);
    start('client',clientDir,client,clientId); await waitFor('client',/connected to server/); await waitFor('server',/has connected/);
    evidence.result='passed'; console.log('PASS: native mutual TLS and input protocol handshake; loopback only; no input injected.');
  } catch(error) { evidence.result='failed'; evidence.error=error.message; console.error(error.message); console.error(evidence.logs.map(l=>`[${l.role}] ${l.text}`).join('').slice(-10000)); process.exitCode=1; }
  finally {
    await Promise.all(children.map(child=>new Promise(resolve=>{if(child.exitCode!==null)return resolve(); const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},3000).unref();child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill();})));
    const output=process.argv[2] || path.join(root,'native-evidence.json'); fs.writeFileSync(output,JSON.stringify(evidence,null,2)); console.log(`Evidence: ${output}`);
  }
}
main();
