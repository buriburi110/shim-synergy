const $ = id => document.getElementById(id);
const api = window.synergy;
const preview = { preview: true, platform: 'win32', status: 'idle', engineReady: false, addresses: [], version: '0.1.1', fingerprint: '', logs: [], settings: { role: 'client', name: 'shim-windows', position: 'right', clipboard: true, swapModifiers: true, peer: null } };
let state = preview, busy = false, challenge = null, toastTimer;
const number = fp => (fp || '').slice(0, 12).toUpperCase().match(/.{1,4}/g)?.join(' · ') || '—';
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3500); }
function openDialog(id) { if (!$(id).open) $(id).showModal(); }
async function invoke(channel, ...args) {
  if (!api) { toast('화면 미리보기입니다. 입력 공유는 설치한 앱에서 사용할 수 있어요.'); return null; }
  const result = await api.invoke(channel, ...args);
  if (!result.ok) { toast(result.error); return null; }
  return result.value;
}
function render(next) {
  state = next; const s = state.settings, server = s.role === 'server', connected = state.status === 'connected';
  $('preview').hidden = !state.preview;
  const names = { idle: '연결 전', starting: '연결 시작 중', connected: '연결됨', listening: '상대 컴퓨터 대기 중', reconnecting: '다시 연결하는 중', error: '연결 확인 필요' };
  $('status').className = 'status ' + state.status;
  $('status').replaceChildren(Object.assign(document.createElement('i'), {}), document.createTextNode(state.pairingExpires > Date.now() && !connected ? '연결 요청을 받고 있어요' : names[state.status] || '상태 확인 중'));
  $('error').hidden = !state.error; $('error').textContent = state.error || '';
  $('desk-canvas').className = 'desk-canvas ' + s.position;
  for (const button of document.querySelectorAll('[data-position]')) { button.classList.toggle('selected', button.dataset.position === s.position); button.disabled = !server && !!s.peer; }
  $('layout-hint').textContent = !server && s.peer ? '화면 배치는 주 컴퓨터에서 바꿔 주세요' : '화면을 끌어 위치를 바꿀 수도 있어요';
  const localMac = state.platform === 'darwin';
  $('mac-local').hidden = !localMac; $('win-local').hidden = localMac;
  $('mac-name').textContent = localMac ? s.name : s.peer?.name || 'shim-mac';
  $('win-name').textContent = !localMac ? s.name : s.peer?.name || 'shim-windows';
  const macServer = localMac ? server : !server;
  $('mac-role').textContent = macServer ? '주 컴퓨터' : '함께 쓰는 컴퓨터';
  $('win-role').textContent = !macServer ? '주 컴퓨터' : '함께 쓰는 컴퓨터';
  for (const key of ['mac-state','win-state']) $(key).textContent = connected ? '● 안전하게 연결됐어요' : s.peer ? '● 연결 정보가 저장됐어요' : '○ 연결을 기다리고 있어요';
  const effective = macServer ? s.position : {left:'right',right:'left',above:'below',below:'above'}[s.position];
  const direction = { left: '왼쪽', right: '오른쪽', above: '위쪽', below: '아래쪽' }[effective];
  $('flow-caption').textContent = `${macServer ? '맥' : '윈도우'} 화면 ${direction} 끝으로 마우스를 움직이면 ${macServer ? '윈도우로' : '맥으로'} 이어집니다.`;
  $('modifier-description').textContent = macServer ? '맥의 ⌘를 윈도우의 Ctrl로 연결합니다.' : '윈도우의 Ctrl을 맥의 ⌘로 연결합니다.';
  $('connect-title').textContent = server ? '이 컴퓨터의 키보드·마우스로 함께 쓰기' : `${macServer ? '맥' : '주 컴퓨터'}의 IP 주소로 연결하기`;
  $('connect-description').textContent = server ? '‘연결 받기’를 누른 뒤, 다른 컴퓨터에 아래 IP를 입력하세요.' : '주 컴퓨터에서 ‘연결 받기’를 누르고, IP를 입력하세요.';
  $('host-label').hidden = server;
  $('connect').textContent = busy ? '연결 요청 중…' : s.peer ? (state.status === 'idle' || state.status === 'error' ? '다시 연결하기 ↗' : '연결 중') : server ? (state.pairingExpires > Date.now() ? '새 연결 받기 ↗' : '연결 받기 ↗') : 'IP 확인하고 연결 ↗';
  $('connect').disabled = busy || (s.peer && !['idle','error'].includes(state.status));
  $('stop').hidden = ['idle','error'].includes(state.status) && !(state.pairingExpires > Date.now());
  if (document.activeElement !== $('host') && s.peer && !server) $('host').value = s.peer.host;
  $('modifier').checked = s.swapModifiers; $('clipboard').checked = s.clipboard;
  $('modifier').disabled = $('clipboard').disabled = !server && !!s.peer;
  $('local-ip').textContent = state.addresses.map(a => a.address).join(' · ') || (state.preview ? '앱에서 확인' : '네트워크를 확인해 주세요');
  $('engine-status').textContent = state.engineReady ? '● 입력 공유 엔진 준비됨' : state.preview ? '미리보기에서는 입력 공유가 실행되지 않습니다' : '○ 입력 공유 엔진 확인 필요';
  $('permissions').hidden = !localMac;
  $('input-permissions').hidden = !localMac;
  $('version').textContent = state.version;
  $('log-output').textContent = state.logs.length ? state.logs.map(l => l.at.slice(11,19) + '  ' + l.text).join('\n') : '아직 연결 기록이 없습니다.';
  if (state.pending) { $('pending-peer').textContent = `${state.pending.peer.platform === 'darwin' ? 'Mac' : 'Windows'} · ${state.pending.peer.name} · ${state.pending.peer.host}`; $('pending-number').textContent = number(state.fingerprint); openDialog('pending-dialog'); }
  else if ($('pending-dialog').open) $('pending-dialog').close();
}
async function update(value) {
  if (!api) { render({ ...state, settings: { ...state.settings, ...value } }); return; }
  await invoke('settings:save', value);
}
for (const element of document.querySelectorAll('[data-close]')) element.onclick = () => $(element.dataset.close).close();
for (const button of document.querySelectorAll('[data-position]')) button.onclick = () => update({ position: button.dataset.position });
$('nav-desk').onclick = () => { window.scrollTo({ top: 0, behavior: 'smooth' }); };
$('nav-settings').onclick = () => { $('computer-name').value = state.settings.name; $('role').value = state.settings.role; openDialog('settings-dialog'); };
$('nav-logs').onclick = () => { $('logs').open = true; $('logs').scrollIntoView({ behavior: 'smooth' }); };
$('help').onclick = () => openDialog('guide-dialog');
$('save-settings').onclick = async () => { if (!api) { await update({ name: $('computer-name').value, role: $('role').value }); $('settings-dialog').close(); return; } const result = await invoke('settings:save', { name: $('computer-name').value, role: $('role').value }); if (result) $('settings-dialog').close(); };
$('forget').onclick = async () => { const result = await invoke('peer:forget'); if (result) $('settings-dialog').close(); };
$('modifier').onchange = e => update({ swapModifiers: e.target.checked });
$('clipboard').onchange = e => update({ clipboard: e.target.checked });
$('copy-ip').onclick = async () => { if (!state.addresses.length) return toast('설치한 앱에서 이 컴퓨터의 IP를 확인해 주세요.'); await invoke('clipboard:copy', state.addresses[0].address); toast('IP 주소를 복사했어요.'); };
$('connect').onclick = async () => {
  if (busy) return;
  if (state.settings.peer) { if (state.settings.role === 'client' && $('host').value.trim() !== state.settings.peer.host) await invoke('address:update', $('host').value.trim()); await invoke('engine:start'); return; }
  if (state.settings.role === 'server') { const code = await invoke('pair:open'); if (code) { toast('10분 동안 연결 요청을 받습니다. 다른 컴퓨터에서 이 IP를 입력하세요.'); $('verify-number').textContent = number(state.fingerprint); $('verify-peer').textContent = `주 컴퓨터 IP: ${state.addresses.map(a => a.address).join(' · ')} · 다른 컴퓨터에서도 같은 번호가 보여야 해요.`; challenge = null; $('confirm-peer').hidden = true; openDialog('verify-dialog'); } return; }
  if (!$('host').value.trim()) { $('host').focus(); toast('주 컴퓨터의 IP 주소를 입력해 주세요.'); return; }
  busy = true; render(state); challenge = await invoke('pair:discover', $('host').value.trim()); busy = false; render(state);
  if (challenge) { $('verify-number').textContent = number(challenge.fingerprint); $('verify-peer').textContent = `${challenge.name} · ${$('host').value.trim()}`; $('confirm-peer').hidden = false; openDialog('verify-dialog'); }
};
$('confirm-peer').onclick = async () => { if (!challenge || busy) return; $('verify-dialog').close(); busy = true; render(state); toast('주 컴퓨터에서 연결을 허용해 주세요.'); await invoke('pair:connect'); busy = false; render(state); };
$('stop').onclick = () => invoke('engine:stop');
$('approve').onclick = async () => { if (state.pending) await invoke('pair:respond', state.pending.id, true); if ($('verify-dialog').open) $('verify-dialog').close(); };
$('deny').onclick = () => { if (state.pending) invoke('pair:respond', state.pending.id, false); };
$('permissions').onclick = async () => { await invoke('system:settings', 'accessibility'); toast('Deskflow에 손쉬운 사용 권한과 입력 모니터링 권한을 허용해 주세요.'); };
$('input-permissions').onclick = () => invoke('system:settings', 'input');
$('open-log').onclick = () => invoke('logs:open');
$('host').onkeydown = e => { if (e.key === 'Enter') $('connect').click(); };
let dragStart = null;
for (const card of [$('mac-card'), $('win-card')]) {
  card.onpointerdown = e => { if (state.settings.peer && state.settings.role !== 'server') return; dragStart = { x: e.clientX, y: e.clientY, card }; card.classList.add('dragging'); card.setPointerCapture(e.pointerId); };
  card.onpointerup = e => { if (!dragStart) return; const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y; const sign = card.id === 'win-card' ? 1 : -1; card.classList.remove('dragging'); dragStart = null; if (Math.max(Math.abs(dx), Math.abs(dy)) < 25) return; update({ position: Math.abs(dx) > Math.abs(dy) ? (dx * sign > 0 ? 'right' : 'left') : (dy * sign > 0 ? 'below' : 'above') }); };
  card.onpointercancel = () => { card.classList.remove('dragging'); dragStart = null; };
}
render(state);
if (api) { api.onState(render); invoke('state:get').then(value => { if (value) render(value); }); }
