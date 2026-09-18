import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {formatCompactEffectProtocol}=require('../src/game-core/authoredEffectProtocol.ts');
for(const placement of ['runtime','initial-draft']) {
 const prompt=formatCompactEffectProtocol(placement);
 assert.match(prompt,/主动.*dialogue/);
 assert.match(prompt,/首项显示在最右侧/);
 assert.match(prompt,/不输出序号、位置、stageSlot/);
 assert.match(prompt,/先写后排、后写前排/);
}
for(const file of ['1变量数据结构.md','2战斗内容生成要求.md','6远征节点协议.md']) {
 const text=fs.readFileSync('worldbook_new/'+file,'utf8');
 assert.match(text,/首项显示最右/);
 assert.match(text,/dialogue/);
}
console.log('PASS shared battle dialogue and array formation authoring contract');

