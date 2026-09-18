// Whitelist-only analysis of one owned request in the retained local backend log.
// Never eval, decode headers, persist messages, or inspect response/reasoning text.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const bytes = readFileSync('tmp/tavern-server-v73.stdout.log');
const log = bytes.toString('utf8').replace(/\x1b\[[0-9;]*m/g, '');
const base = 'MWG_TOWER_STRUCTURED_REQUEST:mwg-single-floor-start-0-1788774945093__';
const blocks = log.split('Chat Completion request:').slice(1).filter(block => block.includes(base));
function literal(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const a = literal(node.left), b = literal(node.right);
    assert.equal(typeof a, 'string'); assert.equal(typeof b, 'string'); return a + b;
  }
  throw Error(`Unsupported string syntax ${node.kind}`);
}
const results = [];
for (const block of blocks) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, block.trimStart());
  let depth = 0, end = 0;
  assert.equal(scanner.scan(), ts.SyntaxKind.OpenBraceToken);
  depth++;
  while (depth) {
    const token = scanner.scan();
    assert.notEqual(token, ts.SyntaxKind.EndOfFileToken, 'complete logged request required');
    if (token === ts.SyntaxKind.OpenBraceToken) depth++;
    if (token === ts.SyntaxKind.CloseBraceToken) depth--;
    end = scanner.getTextPos();
  }
  const source = ts.createSourceFile('owned.ts', `const data=${block.trimStart().slice(0, end)};`, ts.ScriptTarget.Latest, true);
  assert.equal(source.parseDiagnostics.length, 0, 'no ambiguous/truncated logged request');
  const root = source.statements[0].declarationList.declarations[0].initializer;
  assert.ok(ts.isObjectLiteralExpression(root));
  const messagesNode = root.properties.find(p => ts.isPropertyAssignment(p) && p.name?.text === 'messages')?.initializer;
  assert.ok(messagesNode && ts.isArrayLiteralExpression(messagesNode));
  const messages = messagesNode.elements.map(node => {
    assert.ok(ts.isObjectLiteralExpression(node));
    const field = name => node.properties.find(p => ts.isPropertyAssignment(p) && p.name?.text === name)?.initializer;
    return { role: literal(field('role')), content: literal(field('content')) };
  });
  const text = messages.map(m => m.content).join('\n');
  const markers = [...new Set(text.match(/MWG_TOWER_STRUCTURED_REQUEST:mwg-single-floor-start-0-\d+__[A-Za-z0-9_]+/g))];
  assert.equal(markers.length, 1); assert.ok(markers[0].startsWith(base));
  const probes = ['[爬塔开局：精简机制草稿', '[MWG_SCHEMA_COMPATIBILITY/v1]', 'registry 固定为',
    '所有完整状态定义只在 registry.statuses', '复制现有牌必须使用 copy/double',
    'discarded_card_type', 'attacks_discarded_this_turn', 'recovered_attack',
    'player.statuses', 'CURRENT_START_STATE=', 'ESTABLISHED_NARRATIVE='];
  const compatibility = messages.find(m => m.content.startsWith('[MWG_SCHEMA_COMPATIBILITY/v1]\n'));
  let actualSchemaChecks;
  if (compatibility) {
    const schema = JSON.parse(compatibility.content.slice(compatibility.content.indexOf('\n', compatibility.content.indexOf('\n') + 1) + 1));
    const validate = part => new Ajv2020({ strict: false }).compile({
      ...(schema.$defs ? { $defs: schema.$defs } : {}), ...part,
    });
    const lust = validate(schema.properties.player.properties.player_lust_effect);
    const card = validate(schema.properties.player.properties.cards.items);
    actualSchemaChecks = {
      lustModifierAccepted: lust({ name: 'probe', effects: [{ modify: 'damage_taken', multiply: 2 }] }),
      cardToHandAccepted: card({ id: 'probe', name: 'probe', type: 'Skill', rarity: 'Common', cost: 1,
        quantity: 1, effects: [{ add_card: 'spark', to: 'hand' }] }),
    };
  }
  results.push({ marker: markers[0], messageCount: messages.length, characters: text.length, actualSchemaChecks,
    messageShapes: messages.map(m => ({ role: m.role, characters: m.content.length,
      sha256: createHash('sha256').update(m.content).digest('hex') })),
    probes: Object.fromEntries(probes.map(p => [p, text.split(p).length - 1])) });
}
assert.ok(results.length);
console.log(JSON.stringify({ sourceBytes: bytes.length, sourceSha256: createHash('sha256').update(bytes).digest('hex'),
  results, limits: 'Retained backend requests, not provider-internal count or complete log guarantee. Only message lengths/hashes and fixed probes retained; no credentials, raw prompts, responses or reasoning.' }, null, 2));
