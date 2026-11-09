#!/usr/bin/env node
// Maintainer only. Packs extension/ into extension/milo-kit-settings-<version>.vsix (the installer installs it).
// Bundles lib/apply.js and the jsonc parser so the settings tab works even without ~/.milo-kit/kit.
// Usage: node scripts/build-extension.js   (needs the `zip` command, built into macOS)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const KIT = path.join(__dirname, '..');
const SRC = path.join(KIT, 'extension');
const pkg = JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8'));
const out = path.join(SRC, `${pkg.name}-${pkg.version}.vsix`);

const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'milo-vsix-'));
const ext = path.join(stage, 'extension');
fs.mkdirSync(ext);
for (const f of ['package.json', 'extension.js', 'media']) fs.cpSync(path.join(SRC, f), path.join(ext, f), { recursive: true });
fs.mkdirSync(path.join(ext, 'lib'));
for (const f of ['apply.js', 'skills.js', 'skill-actions.js']) fs.copyFileSync(path.join(KIT, 'lib', f), path.join(ext, 'lib', f));
fs.cpSync(path.join(KIT, 'lib', 'vendor'), path.join(ext, 'lib', 'vendor'), { recursive: true });
fs.writeFileSync(path.join(ext, 'readme.md'), `# ${pkg.displayName}\n\n${pkg.description}\n\nPart of Milo Kit. Open it from the editor "..." menu: Milo Kit settings.\n`);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
fs.writeFileSync(path.join(stage, 'extension.vsixmanifest'), `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${pkg.name}" Version="${pkg.version}" Publisher="${pkg.publisher}" />
    <DisplayName>${esc(pkg.displayName)}</DisplayName>
    <Description xml:space="preserve">${esc(pkg.description)}</Description>
    <Categories>Other</Categories>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${pkg.engines.vscode}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="ui" />
    </Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/readme.md" Addressable="true" />
  </Assets>
</PackageManifest>
`);
fs.writeFileSync(path.join(stage, '[Content_Types].xml'), '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".json" ContentType="application/json"/><Default Extension=".js" ContentType="application/javascript"/><Default Extension=".html" ContentType="text/html"/><Default Extension=".css" ContentType="text/css"/><Default Extension=".svg" ContentType="image/svg+xml"/><Default Extension=".png" ContentType="image/png"/><Default Extension=".woff" ContentType="font/woff"/><Default Extension=".md" ContentType="text/markdown"/><Default Extension=".txt" ContentType="text/plain"/><Default Extension=".vsixmanifest" ContentType="text/xml"/></Types>');

for (const f of fs.readdirSync(SRC)) if (f.endsWith('.vsix')) fs.rmSync(path.join(SRC, f));
execFileSync('zip', ['-qrX', out, 'extension.vsixmanifest', '[Content_Types].xml', 'extension'], { cwd: stage });
fs.rmSync(stage, { recursive: true, force: true });
console.log(`Built ${path.relative(KIT, out)}`);
