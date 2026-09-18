// Isolated verification build: never install, version, or overwrite dist.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,existsSync,copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const candidate=process.argv[2];
assert.match(candidate||'',/^[a-z0-9][a-z0-9-]{2,48}$/,'supply a new local candidate label');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const files=root=>readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(`${root}/${e.name}`):[`${root}/${e.name}`]);
const hashes=paths=>Object.fromEntries(paths.sort().map(p=>[p,hash(p)]));
const extensionRoot=`tmp/extension-build-${candidate}`,runtimeRoot=`tmp/runtime-build-${candidate}`;
const beforeFile=`tmp/source-before-${candidate}.json`,bindingFile=`tmp/build-binding-${candidate}.json`;
for(const path of [extensionRoot,runtimeRoot,beforeFile,bindingFile])assert.equal(existsSync(path),false,`refuse overwrite: ${path}`);
const sourcePaths=[...files('src'),...files('worldbook_new'),...files('schemas'),...files('scripts'),
  'package.json','package-lock.json','release.config.json','webpack.config.ts','webpack.sillytavern-extension.config.mjs',
  'tsconfig.json','tsconfig.sillytavern-extension.json','sillytavern-extension/manifest.json'];
const sourceHashes=hashes(sourcePaths);
const protectedRoots=['dist','../_codex-tavern-e2e/public/scripts/extensions/third-party/magic-girl-design-assistant'];
const protectedHashes=hashes(protectedRoots.flatMap(files));
writeFileSync(beforeFile,JSON.stringify({sourceHashes,protectedHashes},null,2),{flag:'wx'});
function run(args,stage,env={}) {
  const log=`tmp/${stage}-${candidate}.log`;
  assert.equal(existsSync(log),false,`refuse log overwrite: ${log}`);
  const r=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true,env:{...process.env,...env},maxBuffer:16*1024*1024});
  writeFileSync(log,(r.stdout||'')+(r.stderr||''),{flag:'wx'});
  assert.equal(r.status,0,`${log}: ${r.error?.message||'command failed'}`);
  console.log(`PASS ${log}`);
}
run(['node_modules/webpack-cli/bin/cli.js','--config','webpack.sillytavern-extension.config.mjs','--mode','production','--output-path',resolve(extensionRoot)],'extension-build');
copyFileSync('sillytavern-extension/manifest.json',`${extensionRoot}/manifest.json`);
const env={MWG_BUILD_OUTPUT_ROOT:resolve(runtimeRoot)};
run(['node_modules/webpack-cli/bin/cli.js','--mode','production'],'runtime-build',env);
run(['scripts/export-tavern-runtime.mjs'],'runtime-export',env);
run(['scripts/export-tavern-interface.mjs'],'interface-export',env);
run(['scripts/test-sillytavern-extension-package.mjs'],'package',{ST_EXTENSION_TEST_OUTPUT:resolve(extensionRoot)});
run(['scripts/test-tavern-character-runtime.mjs'],'character-runtime',env);
assert.deepEqual(hashes(sourcePaths),sourceHashes,'source changed during build');
assert.deepEqual(hashes(protectedRoots.flatMap(files)),protectedHashes,'protected artifacts changed');
const result={candidate,extensionRoot,runtimeRoot,extensionSha256:hash(`${extensionRoot}/index.js`),
  runtimeSha256:hash(`${runtimeRoot}/tavern/character-runtime.js`),sourceHashes,
  artifactHashes:hashes([...files(extensionRoot),...files(runtimeRoot)]),distAndInstalledArtifactsUnchanged:true,
  installed:false,browserAcceptance:false,overallAcceptance:false};
writeFileSync(bindingFile,JSON.stringify(result,null,2),{flag:'wx'});
console.log(JSON.stringify({candidate,sourceFiles:Object.keys(sourceHashes).length,protectedFiles:Object.keys(protectedHashes).length,
  extensionSha256:result.extensionSha256,runtimeSha256:result.runtimeSha256,installed:false}));
