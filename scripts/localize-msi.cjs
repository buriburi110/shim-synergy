const fs = require('node:fs');
module.exports = async function localize(file) {
  let xml = fs.readFileSync(file, 'utf8');
  if (!xml.includes('Language="1033"')) throw new Error('Windows 설치 템플릿이 바뀌었습니다. 한국어 설정을 확인해 주세요.');
  xml = xml.replace('Language="1033"', 'Language="1042"')
    .replace('Windows 7 and above is required', 'Windows 10 이상이 필요합니다.')
    .replace('Installed OR VersionNT &gt;= 601','Installed OR VersionNT &gt;= 1000')
    .replace('Installed OR VersionNT >= 601','Installed OR VersionNT >= 1000')
    .replace('A newer version of &quot;[ProductName]&quot; is already installed.', '더 최신 버전이 이미 설치되어 있습니다.')
    .replace('A newer version of "[ProductName]" is already installed.', '더 최신 버전이 이미 설치되어 있습니다.');
  fs.writeFileSync(file, xml);
};
