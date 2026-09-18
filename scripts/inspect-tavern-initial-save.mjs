// Read-only real Tavern evidence capture; never writes a chat or selects a character.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createTavernApi, getChat } from './lib/tavern-api.mjs';

async function inspect() {
  const args = process.argv.slice(2);
  const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  assert.ok(
    !args.includes('--expect-unpublished') || !option('--compare'),
    'failure capture is not a successful reload comparison',
  );
  const avatar = option('--avatar');
  const chatId = option('--chat');
  assert.ok(avatar && chatId, 'Usage: --avatar <exact.png> --chat <exact chat name> [--label before|after]');
  const label = option('--label') || 'snapshot';
  assert.match(label, /^[a-z0-9_-]+$/i);
  const api = await createTavernApi('http://127.0.0.1:8012/');
  const records = await getChat(api, avatar, chatId);
  assert.ok(Array.isArray(records) && records.length > 1, 'exact chat must exist');
  const metadata = records[0].chat_metadata;
  const message = records[1];
  const root = message.variables?.[message.swipe_id ?? 0];
  const receipt = root?.mwg_tower_initial_commit;
  const publication = metadata?.mwg_tower_initial_publication;
  assert.ok(root?.stat_data && root.schema, 'real MVU root requires stat_data and schema');
  if (args.includes('--expect-unpublished')) {
    // A failure capture is explicitly a failed initial sample, not a weaker
    // publication verifier. The default success/compare path below is unchanged.
    assert.ok(!receipt && !publication && !root?.stat_data?.run, 'expected no partial committed run');
    assert.equal(root?.stat_data?.battle?.cards?.length ?? 0, 0, 'expected no partial authored deck');
    const summary = {
      chatId,
      avatar,
      swipeId: message.swipe_id,
      messageCount: records.length - 1,
      initialPublished: false,
      hasReceipt: false,
      hasRun: false,
      cardQuantity: 0,
      note: 'Failure evidence only; no committed initial deck or publication. Not a passed initial sample.',
    };
    const dir = resolve('tmp/live-initial-v19');
    await mkdir(dir, { recursive: true });
    const evidence = resolve(dir, `${label}-${Date.now()}.json`);
    await writeFile(evidence, JSON.stringify({ summary, records }, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ ...summary, evidence }, null, 2));
    return;
  }
  assert.equal(receipt?.chatId, chatId);
  assert.equal(receipt?.messageId, 0);
  assert.deepEqual(publication, {
    spec: 'mwg.tower-initial-publication/v1',
    chatId,
    messageId: 0,
    swipeId: message.swipe_id ?? 0,
    generationId: receipt.generationId,
    stateDigest: receipt.stateDigest,
  });
  const stable = value =>
    JSON.stringify(value, (_key, child) =>
      child && typeof child === 'object' && !Array.isArray(child)
        ? Object.fromEntries(
            Object.keys(child)
              .sort()
              .map(key => [key, child[key]]),
          )
        : child,
    );
  const hash = value => createHash('sha256').update(stable(value)).digest('hex');
  const stat = root.stat_data;
  const summary = {
    chatId,
    avatar,
    swipeId: message.swipe_id,
    messageCount: records.length - 1,
    publication,
    storyHash: hash(message.mes),
    cardsHash: hash(stat.battle.cards),
    coreHash: hash(stat.battle.core),
    mapHash: hash(stat.run.map),
    inventoryHash: hash({
      cards: stat.battle.cards,
      artifacts: stat.battle.artifacts,
      items: stat.battle.items,
      statuses: stat.battle.statuses,
      abilities: stat.battle.player_abilities,
      playerStatusEffects: stat.battle.player_status_effects,
    }),
    progressHash: hash({
      level: stat.battle.level,
      exp: stat.battle.exp,
      reward: stat.reward,
      runResult: stat.run_result,
    }),
    runHash: hash(stat.run),
    cardQuantity: stat.battle.cards.reduce((sum, card) => sum + Number(card.quantity ?? 1), 0),
    run: {
      seed: stat.run.seed,
      revision: stat.run.stateRevision,
      phase: stat.run.phase,
      opening: stat.run.opening.phase,
      gold: stat.run.gold,
      visitedNodes: stat.run.visitedNodeIds.map(id => {
        const node = stat.run.map.nodes.find(node => node.id === id);
        return { id, kind: node?.kind, contentPhase: stat.run.nodeContent[id]?.phase };
      }),
      nodes: Object.entries(stat.run.nodeContent)
        .filter(([, value]) => !['idle', 'abandoned'].includes(value.phase))
        .map(([id, value]) => ({ id, phase: value.phase, attempts: value.attempts })),
    },
    note: 'Disk capture after publication; background node preparation may legitimately advance the full stat digest.',
  };
  const dir = resolve('tmp/live-initial-v19');
  await mkdir(dir, { recursive: true });
  const evidence = resolve(dir, `${label}-${Date.now()}.json`);
  await writeFile(evidence, JSON.stringify({ summary, records }, null, 2), { flag: 'wx' });
  if (option('--compare')) {
    const before = JSON.parse(await readFile(resolve(option('--compare')), 'utf8')).summary;
    for (const field of [
      'chatId',
      'avatar',
      'swipeId',
      'messageCount',
      'publication',
      'storyHash',
      'cardsHash',
      'coreHash',
      'mapHash',
      'inventoryHash',
      'progressHash',
      'runHash',
    ]) {
      assert.ok(Object.hasOwn(before, field), `comparison capture lacks ${field}`);
      assert.deepEqual(summary[field], before[field], `${field} changed; inspect ${evidence}`);
    }
    summary.matchesComparison = true;
  }
  console.log(JSON.stringify({ ...summary, evidence }, null, 2));
}
await inspect();
