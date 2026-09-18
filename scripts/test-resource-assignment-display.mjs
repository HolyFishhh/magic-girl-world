import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');
const {describeCompactContent}=require('../src/game-core/contentDescription.ts');
const {compactContentToDisplayTags}=require('../src/game-core/effectDisplay.ts');
const {describeResourceHalf}=require('../src/game-core/resourceAssignmentDisplay.ts');
const {renderStatusReferences}=require('../src/shared/statusReference.ts');
const context={resourceNames:{matter:'原初物质'}};
for(const value of ['floor(self.resource.matter.current / 2)','floor(0.5 * self.resource.matter.current)']) {
 const input={effects:{set_resource:{id:'matter',value},to:'self'}};
 const before=JSON.stringify(input);
 const compact=describeCompactContent(input,context);
 const tags=compactContentToDisplayTags(input,context);
 assert.match(compact,/原初物质设为一半（向下取整）/);
 assert.match(tags.map(t=>t.text).join(''),/原初物质设为一半（向下取整）/);
 const html=renderStatusReferences(tags[0].text,[tags[0].reference]);
 assert.match(html,/查看资源：原初物质/);
 assert.match(html,/data-status-rules/);
 assert.equal(JSON.stringify(input),before);
}
assert.equal(describeResourceHalf('floor(opponent.resource.matter.current / 2)','self','matter'),undefined);
assert.equal(describeResourceHalf('ceil(self.resource.matter.current / 2)','self','matter'),undefined);
assert.equal(describeResourceHalf('floor(self.resource.other.current / 2)','self','matter'),undefined);
const conditional={effects:{damage:4,when:'skills_played_this_turn > 0'}};
assert.match(describeCompactContent(conditional),/本回合使用技能牌的次数/);
assert.match(compactContentToDisplayTags(conditional).map(t=>t.text).join(''),/本回合使用技能牌的次数/);
console.log('Readable resource assignments and played-card counters agree across both display chains; inputs unchanged.');
