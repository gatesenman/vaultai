/**
 * Patch app-builder-lib NsisTarget to extract uninstaller without wine
 * (wine 6 on this Linux box cannot run modern NSIS PE).
 * Idempotent. Run after npm install when building Windows NSIS on Linux.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js');
if (!existsSync(target)) {
  console.log('skip nsis patch: NsisTarget.js missing');
  process.exit(0);
}
let text = readFileSync(target, 'utf8');
if (text.includes('VaultAI patch: wine 6 cannot run modern NSIS')) {
  console.log('nsis patch already applied');
  process.exit(0);
}
const old = `        else {
            const wineVm = new WineVm_1.WineVmManager((_a = packager.config.toolsets) === null || _a === void 0 ? void 0 : _a.wine);
            await wineVm.exec(installerPath, [], { env: { __COMPAT_LAYER: "RunAsInvoker" } });
        }`;
const neu = `        else {
            // VaultAI patch: wine 6 cannot run modern NSIS PE on this box; use UninstallerReader like macOS Catalina path.
            try {
                await nsisUtil_1.UninstallerReader.exec(installerPath, uninstallerPath);
            }
            catch (error) {
                builder_util_1.log.warn(\`UninstallerReader failed, falling back to wine: \${error.message}\`);
                const wineVm = new WineVm_1.WineVmManager((_a = packager.config.toolsets) === null || _a === void 0 ? void 0 : _a.wine);
                await wineVm.exec(installerPath, [], { env: { __COMPAT_LAYER: "RunAsInvoker" } });
            }
        }`;
if (!text.includes(old)) {
  console.warn('nsis patch: pattern not found (electron-builder version changed?)');
  process.exit(0);
}
writeFileSync(target, text.replace(old, neu));
console.log('nsis patch applied');
