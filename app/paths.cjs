const fs = require('node:fs');
const path = require('node:path');
function findEngine(app) {
  const root = app.isPackaged ? path.join(process.resourcesPath, 'engine') : path.join(__dirname, '..', 'engine', `${process.platform === 'win32' ? 'win' : 'mac'}-${process.arch}`);
  const candidates = process.platform === 'win32' ? [path.join(root, 'deskflow-core.exe')] : [path.join(root, 'Deskflow.app', 'Contents', 'MacOS', 'deskflow-core'), '/Applications/Deskflow.app/Contents/MacOS/deskflow-core'];
  return candidates.find(file => fs.existsSync(file)) || null;
}
module.exports = { findEngine };
