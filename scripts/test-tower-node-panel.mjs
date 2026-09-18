import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseFragment } from 'parse5';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const runCore = require('../src/game-core/runState.ts');
const { renderTowerNodePanel } = require('../src/common/towerNodePanel.ts');
const { rewardPreviewLabel } = require('../src/shared/rewardSelectionInteraction.ts');
assert.equal(rewardPreviewLabel('card', { name: '同名牌', quantity: 3 }), '卡牌：同名牌 ×3');
assert.equal(rewardPreviewLabel('card', { name: '同名牌', quantity: 1 }), '卡牌：同名牌 ×1');

class FakeEventTarget {
  listeners = new Map();
  addEventListener(type, listener) {
    const values = this.listeners.get(type) ?? [];
    values.push(listener);
    this.listeners.set(type, values);
  }
  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) ?? []) listener.call(this, event);
  }
}

class FakeClassList {
  constructor(element) {
    this.element = element;
  }
  values() {
    return this.element.className.split(/\s+/).filter(Boolean);
  }
  contains(value) {
    return this.values().includes(value);
  }
  toggle(value, force) {
    const values = this.values().filter(entry => entry !== value);
    if (force ?? !this.contains(value)) values.push(value);
    this.element.className = values.join(' ');
  }
}

class FakeElement extends FakeEventTarget {
  constructor(ownerDocument, tagName) {
    super();
    this.ownerDocument = ownerDocument;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.className = '';
    this.classList = new FakeClassList(this);
    this.dataset = {};
    this.style = {};
    this.attributes = new Map();
    this.disabled = false;
    this.checked = false;
    this.type = '';
    this._textContent = '';
  }
  get textContent() {
    return this._textContent + this.children.map(child => child.textContent).join('');
  }
  set innerHTML(value) {
    const convert = node => {
      const el = new FakeElement(this.ownerDocument, node.tagName || 'span');
      if (node.nodeName === '#text') el._textContent = node.value;
      for (const attr of node.attrs || []) {
        el.setAttribute(attr.name, attr.value);
        if (attr.name === 'class') el.className = attr.value;
      }
      el.append(...(node.childNodes || []).map(convert));
      return el;
    };
    this.replaceChildren(...parseFragment(value).childNodes.map(convert));
  }
  set textContent(value) {
    this._textContent = String(value ?? '');
    this.children = [];
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    this.children = [];
    this._textContent = '';
    this.append(...nodes);
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
  matches(selector) {
    return selector.split(',').some(part => {
      const value = part.trim();
      if (!value) return false;
      if (value.startsWith('.')) return this.classList.contains(value.slice(1));
      const typedInput = value.match(/^input\[type=["']?([^\]"']+)["']?\]$/i);
      if (typedInput) return this.tagName === 'INPUT' && this.type === typedInput[1];
      return this.tagName === value.toUpperCase();
    });
  }
  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }
  querySelectorAll(selector) {
    return descendants(this).filter(element => element.matches(selector));
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  click() {
    if (this.disabled) return;
    if (this.tagName === 'INPUT' && this.type === 'checkbox') {
      this.checked = !this.checked;
      this.dispatchEvent({ type: 'click', target: this });
      this.dispatchEvent({ type: 'change', target: this });
      return;
    }
    this.dispatchEvent({ type: 'click', target: this });
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(this, tagName);
  }
  createTextNode(value) {
    const node = new FakeElement(this, '#text');
    node.textContent = value;
    return node;
  }
}

function descendants(root) {
  return root.children.flatMap(child => [child, ...descendants(child)]);
}

function withClass(root, className) {
  return descendants(root).filter(element => element.classList.contains(className));
}

function withDataset(root, key, value) {
  return descendants(root).filter(
    element => element.dataset[key] !== undefined && (value === undefined || element.dataset[key] === value),
  );
}

function claimOpeningGift(root, id) {
  withDataset(root, 'choiceId', id)[0].click();
  withClass(root, 'tower-opening-confirm')[0].click();
}

function reach(kind) {
  for (let seed = 1; seed <= 180; seed += 1) {
    let run = runCore.createRunState({ seed });
    const path = run.map.acts[0].paths.find(candidate =>
      candidate.some(nodeId => run.map.nodes.find(node => node.id === nodeId)?.kind === kind),
    );
    if (!path) continue;
    for (const nodeId of path) {
      const choice = run.choices.find(entry => entry.id === nodeId);
      assert.ok(choice);
      if (choice.kind === kind) return runCore.enterRunNode(run, choice.id);
      run = runCore.completeRunNode(runCore.enterRunNode(run, choice.id), { outcome: 'cleared' });
    }
  }
  throw new Error(`unable to reach ${kind}`);
}

const document = new FakeDocument();
const root = document.createElement('main');
const battle = {
  core: {
    emoji: '🧙',
    hp: 75,
    max_hp: 80,
    resources: [{ id: 'star_charge', name: '星辉', emoji: '⭐', current: 2, max: 5, refresh: 'retain' }],
  },
  cards: [
    {
      id: 'starter_strike',
      name: '起手斩',
      emoji: '⚔️',
      type: 'Attack',
      rarity: 'Common',
      cost: 1,
      quantity: 2,
      effects: { damage: 6 },
    },
  ],
};

// Pending initial acquisition has a real visible action and blocks the opening panel.
{
  const run=runCore.createRunState({seed:7});
  run.opening={phase:'ready',attempts:1,content:{title:'馈赠',narrative:'稍后选择',choices:[
    {id:'gift',label:'选择馈赠',outcome:{gold:5}},
  ]}};
  const artifact={id:'first_gift',name:'启程之印',rarity:'Common',on_acquire:{max_hp:3}};
  const stat={battle:{...battle,artifacts:[artifact]},initial_artifact_acquisition:{phase:'pending',artifacts:[artifact]}};
  const before=JSON.stringify(stat);let clicked=0;
  renderTowerNodePanel({root,stat,run,isLatest:true,callbacks:{onInitialArtifactAcquisition:()=>clicked++}});
  assert.match(root.textContent,/初始遗物/);
  assert.match(root.textContent,/获得时.*3点生命上限/);
  assert.equal(withClass(root,'tower-opening-confirm').length,0);
  const claim=withClass(root,'tower-node-primary').find(button=>button.textContent==='领取初始遗物效果');
  assert.ok(claim);claim.click();assert.equal(clicked,1);
  assert.equal(JSON.stringify(stat),before,'render and callback do not apply acquisition');
}

// Actual authored sample25 scope mismatch must be visible before choosing the gift.
{
  const item={id:'graphite_grease',name:'坩埚石墨膏',emoji:'🧴',count:1,
    description:'战斗外用：涂抹风炉阀门，也可以应急灌注护壁效果。',effects:[{block:6}]};
  const run=runCore.createRunState({seed:7});
  run.opening={phase:'ready',attempts:1,content:{title:'选择道具',narrative:'测试',
    choices:[{id:'box_graphite',label:'取走润滑脂',outcome:{reward:{items:[item]}}}]}};
  const before=structuredClone(run);let selected='';
  renderTowerNodePanel({root,stat:{battle},run,isLatest:true,callbacks:{onOpeningChoice:id=>{selected=id;}}});
  assert.equal(withClass(root,'item-usage')[0].textContent,'仅战斗中可用');
  assert.match(withClass(root,'content-rules')[0].textContent,/6点格挡/);
  assert.doesNotMatch(withClass(root,'content-rules')[0].textContent,/战斗外用/);
  assert.match(withClass(root,'content-flavor')[0].textContent,/战斗外用/);
  assert.doesNotMatch(withClass(root,'tower-story-choice-effects')[0].textContent,/6点格挡|战斗外用/,
    'acquiring an item must not look like executing its effects immediately');
  assert.deepEqual(run,before,'rendering never fixes prose or alters reward state');
  claimOpeningGift(root, 'box_graphite');assert.equal(selected,'box_graphite');
  item.description='<img src=x onerror="bad()">';
  const hostileRoot=document.createElement('main');
  renderTowerNodePanel({root:hostileRoot,stat:{battle},run,isLatest:true});
  assert.equal(withClass(hostileRoot,'content-flavor').length,0,
    'existing Chinese prose normalizer rejects ASCII markup; it is not executed');
  assert.equal(item.description,'<img src=x onerror="bad()">','display filtering never rewrites source');
  assert.equal(descendants(hostileRoot).some(node=>node.tagName==='IMG'),false,'prose remains text');
}

// Sample169: reward preview must resolve its actual status scope.
{
  const status={id:'fragile',name:'裂音',type:'debuff',emoji:'💥',triggers:{hold:{modify:'damage_taken',add:1}}};
  const run=runCore.createRunState({seed:7});
  const item={id:'pipe',name:'风笛',count:2,effects:[{apply_status:'fragile',stacks:1}]};
  run.opening={phase:'ready',attempts:1,content:{title:'馈赠',narrative:'测试',choices:[
    {id:'pipe',label:'取风笛',outcome:{reward:{items:[item]}}},
    {id:'other',label:'其他奖励',outcome:{reward:{items:[{id:'other',name:'其他',count:1,effects:{block:1},statuses:[status]}]}}},
  ]}};
  const before=structuredClone(run);
  renderTowerNodePanel({root,stat:{battle:{...battle,statuses:[status]}},run,isLatest:true});
  assert.match(withClass(root,'content-rules')[0].textContent,/裂音/);
  assert.match(withClass(root,'mwg-status-reference')[0].getAttribute('data-status-rules'),/受到的伤害增加1/);
  assert.doesNotMatch(withClass(root,'content-rules')[0].textContent,/未注册/);
  renderTowerNodePanel({root,stat:{battle:{...battle,statuses:[]}},run,isLatest:true});
  assert.match(withClass(root,'content-rules')[0].textContent,/未注册状态/,'another choice cannot supply private definitions');
  item.statuses=[status];
  renderTowerNodePanel({root,stat:{battle:{...battle,statuses:[]}},run,isLatest:true});
  assert.match(withClass(root,'mwg-status-reference')[0].getAttribute('data-status-rules'),/受到的伤害增加1/);
  delete item.statuses;assert.deepEqual(run,before,'preview never changes original definitions or rewards');
}

// Opening choices expose narrative and natural-language outcome tags.
{
  const run = runCore.createRunState({ seed: 7 });
  run.opening = {
    phase: 'ready',
    attempts: 1,
    content: {
      title: '星门守望者',
      narrative: '守望者把两份启程礼放在门前。',
      choices: [
        { id: 'gold', label: '接过钱袋', description: '准备沿途交易。', outcome: { gold: 30, lust: 6 } },
        { id: 'heal', label: '接受祝福', outcome: { max_hp: 5, max_lust: 5 } },
      ],
    },
  };
  let selected = '';
  assert.equal(
    renderTowerNodePanel({
      root,
      stat: { battle },
      run,
      isLatest: true,
      callbacks: {
        onOpeningChoice: id => {
          selected = id;
        },
      },
    }),
    true,
  );
  assert.ok(root.textContent.includes('星门守望者'));
  assert.ok(root.textContent.includes('金币+30'));
  assert.ok(root.textContent.includes('欲望+6'));
  assert.ok(root.textContent.includes('欲望上限+5'));
  assert.ok(root.textContent.includes('实际变化：'));
  assert.equal(withClass(root, 'tower-story-choice-flavor')[0].textContent, '准备沿途交易。');
  assert.equal(withClass(root, 'is-gain').length, 4);
  assert.equal(withClass(root, 'tower-node-panel')[0].attributes.get('role'), 'region');
  claimOpeningGift(root, 'gold');
  assert.equal(selected, 'gold');
}

// Opening reward faces use the ordinary choice surface, but the existing
// callback runs only after the explicit confirm action.
{
  const run = runCore.createRunState({ seed: 8 });
  run.opening = { phase: 'ready', attempts: 1, content: {
    title: '折叠奖励', narrative: '测试', choices: [{
      id: 'preview-only', label: '查看后再决定', outcome: { reward: { items: [{ id: 'gift', name: '礼物', effects: { block: 3 } }] } },
    }],
  } };
  let selected = 0;
  renderTowerNodePanel({ root, stat: { battle }, run, isLatest: true, callbacks: { onOpeningChoice: () => { selected += 1; } } });
  const face = withClass(root, 'tower-opening-choice-rewards')[0];
  assert.ok(face, 'opening reward face is present on the selectable surface');
  assert.equal(withClass(root, 'tower-opening-choice')[0].classList.contains('is-selected'), false);
  const choice = withClass(root, 'tower-opening-choice')[0];
  const previewSummary = face.parentElement.children[0];
  choice.dispatchEvent({ type: 'click', target: previewSummary, preventDefault() {} });
  const rewardPill = withClass(root, 'reward-preview-pill')[0];
  assert.ok(rewardPill, 'opening reward summary exposes a real-content detail pill');
  rewardPill.click();
  assert.equal(face.parentElement.open, true, 'a reward pill expands the shared detail surface');
  assert.equal(choice.classList.contains('is-selected'), false, 'expanding a reward pill never selects a gift');
  const statusReference = document.createElement('button');
  statusReference.className = 'mwg-status-reference';
  choice.dispatchEvent({ type: 'click', target: statusReference, preventDefault() {} });
  assert.equal(choice.classList.contains('is-selected'), false, 'preview summaries and status references do not select a gift');
  choice.dispatchEvent({ type: 'click', target: face, preventDefault() {} });
  assert.equal(selected, 0, 'selecting a reward face never bypasses the explicit opening claim');
  assert.equal(choice.classList.contains('is-selected'), true, 'face selection highlights through the ordinary checkbox transaction');
  const confirm = withClass(root, 'tower-opening-confirm')[0];
  assert.equal(confirm.disabled, false, 'a selected opening gift enables its explicit claim action');
  confirm.click();
  assert.equal(selected, 1, 'only confirming claims the selected opening gift');
}

// Failed opening is explicit and safely retryable.
{
  const run = runCore.createRunState({ seed: 9 });
  run.opening = { phase: 'failed', attempts: 2, error: '模型返回格式错误' };
  let retried = 0;
  renderTowerNodePanel({
    root,
    stat: { battle },
    run,
    isLatest: true,
    callbacks: {
      onRetryOpening: () => {
        retried += 1;
      },
    },
  });
  assert.ok(root.textContent.includes('模型返回格式错误'));
  withClass(root, 'tower-node-primary')[0].click();
  assert.equal(retried, 1);
}

// Event and rest stay on the same panel and dispatch only structured actions.
{
  const run = reach('event');
  run.opening = { phase: 'consumed', attempts: 1 };
  run.gold = 10;
  const stat = {
    battle,
    run,
    run_node: { title: '雾中石碑', narrative: '石碑要求旅人留下一个选择。' },
    run_event: {
      choices: [
        { id: 'touch', label: '触碰石碑', description: '石碑承诺恢复生命。', outcome: { cost: { hp: 3, max_hp: 2, gold: 4, resources: { star_charge: 1 } }, hp: -4, lust: 8, resources: { star_charge: 1 }, reward: { items: [] } } },
        { id: 'force', label: '强行开启', outcome: { cost: { resources: { unregistered: 1 } }, resources: { star_charge: -3 } } },
        { id: 'leave', label: '绕行', outcome: {} },
      ],
    },
  };
  let selected = '';
  renderTowerNodePanel({
    root,
    stat,
    run,
    isLatest: true,
    callbacks: {
      onEventChoice: id => {
        selected = id;
      },
    },
  });
  assert.ok(root.textContent.includes('雾中石碑'));
  assert.ok(!root.textContent.includes('生命-4'));
  const touchChoice = withDataset(root, 'choiceId', 'touch')[0];
  assert.equal(withClass(touchChoice, 'tower-story-choice-flavor')[0].textContent, '石碑承诺恢复生命。');
  assert.match(touchChoice.textContent, /代价支付3点生命支付2点生命上限支付4金币支付1星辉/,
    'the label need not restate a public cost for the cost to be visible');
  assert.ok(!touchChoice.textContent.includes('实际变化：'));
  assert.ok(!root.textContent.includes('⭐星辉+1'));
  assert.ok(root.textContent.includes('当前条件无法选择'));
  assert.equal(withClass(touchChoice, 'is-cost').length, 4);
  assert.equal(withDataset(root, 'choiceId', 'force')[0].disabled, true);
  withDataset(root, 'choiceId', 'touch')[0].click();
  assert.equal(selected, 'touch');
}
{
  const run = reach('rest');
  run.opening = { phase: 'consumed', attempts: 1 };
  let healed = 0;
  let cardAction = '';
  renderTowerNodePanel({
    root,
    stat: { battle, run_node: { title: '余烬营火' }, run_rest: { description: '火焰仍有温度。' } },
    run,
    isLatest: true,
    callbacks: {
      onRestHeal: () => {
        healed += 1;
      },
      onRestAction: action => {
        cardAction = action;
      },
    },
  });
  assert.ok(root.textContent.includes('恢复 30% 最大生命'));
  withClass(root, 'tower-node-primary')[0].click();
  assert.equal(healed, 1);
  withClass(root, 'tower-node-primary')[1].click();
  assert.equal(cardAction, 'train');
  assert.equal(withClass(root, 'tower-rest-upgrade').length, 0);
  assert.ok(root.textContent.includes('回忆'));
  assert.ok(root.textContent.includes('搜刮'));
}

// A failed combat keeps a terminal panel with one explicit restart action.
{
  const initial = runCore.createRunState({ seed: 77 });
  const active = runCore.enterRunNode(initial, initial.choices[0].id);
  const run = runCore.completeRunNode(active, { outcome: 'failed' });
  let restarted = 0;
  renderTowerNodePanel({
    root,
    stat: { battle },
    run,
    isLatest: true,
    callbacks: {
      onRestart: () => {
        restarted += 1;
      },
    },
  });
  assert.equal(withClass(root, 'tower-node-panel')[0].dataset.panel, 'terminal');
  assert.equal(withClass(root, 'tower-node-primary').length, 1);
  withClass(root, 'tower-node-primary')[0].click();
  assert.equal(restarted, 1);
}

// The completed run uses the shared deterministic finale calculator.
{
  const run = runCore.createRunState({ seed: 88 });
  run.opening = { phase: 'consumed', attempts: 1 };
  run.phase = 'won';
  run.act = run.actCount;
  run.score = { defeatedEnemyScore: 426, averageDifficultyPercent: 91.5,
    encounters: [{nodeId:'scored-fixture',act:1,floor:1,playerDeckScore:465.57,enemyScore:426,relativeDifficulty:0.915,outcome:'victory'}] };
  renderTowerNodePanel({ root, stat: { battle }, run, isLatest: true });
  assert.ok(root.textContent.includes('🐟'));
  assert.ok(root.textContent.includes('426'));
  assert.ok(root.textContent.includes('91.5%'));
  const scene = withClass(root, 'tower-finale-scene')[0];
  assert.equal(scene.hidden, true);
  const ascend = withClass(root, 'tower-finale-ascend')[0];
  assert.equal(ascend.textContent, '爬上塔尖');
  ascend.click();
  assert.equal(scene.hidden, false);
  assert.equal(ascend.hidden, true);
  run.score.encounters = [];
  renderTowerNodePanel({ root, stat: { battle }, run, isLatest: true });
  assert.ok(root.textContent.includes('暂无可比评分'));
  assert.ok(!root.textContent.includes('91.5%'), 'an empty evaluated set never displays a stale precise percentage');
}

// Unknown event cards commit before their outcome becomes visible, including a
// compulsory curse, and the same result remains visible after save restoration.
{
  const {settleTowerEventChoiceInStat}=require('../src/common/runTransactions.ts');
  const run=reach('event'); run.opening={...run.opening,phase:'consumed',attempts:1,content:{title:'启程',narrative:'已启程',choices:[]}};
  const curse={id:'sealed_curse',name:'镜海的诅咒',emoji:'🕸️',type:'Curse',rarity:'Corrupt',quantity:1,
    effects:{damage:3,to:'self'},description:'不祥的回声'};
  const good={id:'sealed_blessing',name:'潮汐祝福',emoji:'🌊',type:'Skill',rarity:'Common',quantity:1,cost:1,effects:{block:5}};
  const stat={battle:structuredClone(battle),run,run_node:{node_id:run.currentNode.id,kind:'event'},
    run_event:{description:'三张盖住的牌。',choices:[
      {id:'left',label:'翻开左侧',description:'背面是一轮月亮。',outcome:{hp:999,gain_cards:[curse]}},
      {id:'right',label:'翻开右侧',description:'背面是一片波纹。',outcome:{gain_cards:[good]}},
      {id:'leave',label:'转身离开',outcome:{gold:12}},
    ]}};
  const towerRequest=require('../src/game-core/towerRequest.ts');
  const parsed=towerRequest.parseTowerNodeResult(JSON.stringify({spec:towerRequest.TOWER_NODE_RESULT_SPEC,
    node_id:run.currentNode.id,request_id:'sealed-event',based_on_revision:run.stateRevision,kind:'event',
    title:'封存的三张牌',narrative:'你面前放着三张盖住的牌。',payload:{event:stat.run_event}}),
    {nodeId:run.currentNode.id,requestId:'sealed-event',basedOnRevision:run.stateRevision,kind:'event'});
  stat.run_event=parsed.payload.event;
  const target=document.createElement('main');
  assert.equal(runCore.validateRunState(run).ok,true,JSON.stringify(runCore.validateRunState(run)));
  renderTowerNodePanel({root:target,stat,run,isLatest:true,callbacks:{onEventChoice:id=>settleTowerEventChoiceInStat(stat,id)}});
  assert.equal(withClass(target,'enhanced-card').length,0);
  assert.doesNotMatch(target.textContent,/镜海的诅咒|潮汐祝福|不祥|999|3点伤害|12/);
  withDataset(target,'choiceId','left')[0].click();
  assert.ok(stat.battle.cards.some(card=>card.id==='sealed_curse'));
  assert.ok(!stat.battle.cards.some(card=>card.id==='sealed_blessing'));
  assert.throws(()=>settleTowerEventChoiceInStat(stat,'right'));
  const restored=JSON.parse(JSON.stringify(stat));
  renderTowerNodePanel({root:target,stat:restored,run:restored.run,isLatest:true});
  assert.equal(withClass(target,'enhanced-card').length,1);
  assert.match(target.textContent,/镜海的诅咒/);assert.doesNotMatch(target.textContent,/潮汐祝福|翻开右侧|999/);
  assert.match(withClass(target,'card-rules')[0].textContent,/3点伤害/);
}

const source = readFileSync('src/common/towerNodePanel.ts', 'utf8');
{
  const run = runCore.createRunState({seed:17});
  run.opening = {phase:'ready',attempts:1,content:{title:'完整馈赠',narrative:'测试',
    choices:[{id:'full-preview',label:'查看全部奖励',outcome:{reward:{
      cards:[{id:'gift-card',name:'馈赠卡',emoji:'🃏',type:'Attack',rarity:'Common',cost:1,quantity:3,effects:{damage:7},description:'<危险>卡牌故事'}],
      artifacts:[{id:'gift-relic',name:'馈赠遗物',emoji:'📿',effects:{block:3},description:'遗物故事'}],
    }}}]}};
  const saved = structuredClone(run);
  const target = document.createElement('main');
  renderTowerNodePanel({root:target,stat:{battle},run,isLatest:true,callbacks:{onOpeningChoice:()=>{}}});
  assert.equal(withClass(target,'enhanced-card').length,1);
  assert.match(withClass(target,'card-rules')[0].textContent,/7点伤害/);
   assert.match(target.textContent,/卡牌：馈赠卡 ×3/,'reward preview and actual-change pill expose card quantity');
  assert.match(withClass(target,'support-details-effects')[0].textContent,/3点格挡/);
  assert.doesNotMatch(target.textContent,/规则：|叙述：/);
  assert.deepEqual(run,saved);
}
assert.equal((source.match(/\.innerHTML\s*=/g) || []).length, 4, 'reward and initial-acquisition faces use escaped shared content renderers');
assert.match(source, /createRewardSelectionOption\(document/);
assert.match(source, /确认领取馈赠/);
assert.doesNotMatch(source, /insertAdjacentHTML\s*\(/);

const styleSource = readFileSync('src/common/index.scss', 'utf8');
assert.match(styleSource, /\.tower-node-primary,[\s\S]*min-height:\s*44px/);
assert.match(styleSource, /\.run-section\.has-tower-map \+ \.action-section/);
assert.match(styleSource, /@media \(min-width:\s*1040px\)/);

console.log('Tower opening, event, rest, and finale panel DOM tests passed.');

{
 const run=reach('shop');run.opening={phase:'consumed',attempts:1};run.gold=150;
 const target=document.createElement('main');
 renderTowerNodePanel({root:target,run,stat:{battle,run_shop:{},run_node:{title:'旅商',narrative:'这里只在统一剧情栏展示一次。'}},isLatest:true});
 assert.match(target.textContent,/商品与删牌服务已陈列在下方/);
 assert.equal(withClass(target,'tower-shop-card-select').length,0,'the node panel must not duplicate the market selector');
 assert.equal(withClass(target,'tower-shop-removal').length,0,'the node panel must not duplicate the market removal control');
 assert.equal(descendants(target).some(el=>el.tagName==='BUTTON'&&el.textContent==='离开商店'),false,'the market owns the only leave action');
 assert.equal(withClass(target,'tower-node-narrative').length,0,'node panel no longer duplicates the shared latest narrative');
 assert.doesNotMatch(source,/callbacks\?\.onShopRemove|callbacks\?\.onLeaveShop/,'shop actions are mounted only by the independent market surface');
}
console.log('PASS node panel leaves shop actions to the independent market; narrative is rendered only by the common story panel.');
{
 const run=reach('event');run.opening={phase:'consumed',attempts:1};
 const fractionalBattle=structuredClone(battle);fractionalBattle.core={...fractionalBattle.core,hp:20.2,max_hp:50,lust:0,max_lust:100};
 const target=document.createElement('main');
 renderTowerNodePanel({root:target,run,stat:{run,battle:fractionalBattle,run_event:{choices:[{id:'left',label:'左',outcome:{card_removals:1}},{id:'right',label:'右',outcome:{}}]}},isLatest:true,callbacks:{onEventChoice:()=>{}}});
 const choices=withClass(target,'tower-story-choice-select');assert.equal(choices.length,2);assert.ok(choices.every(x=>!x.disabled),'fractional post-combat HP must not disable free event choices');
}
