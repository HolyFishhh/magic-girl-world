import fs from 'node:fs';
import { resolve } from 'node:path';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import webpack from 'webpack';

const output = resolve('tmp/ui-refinement-v442');
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false,
  entry: {
    'ui-refinement-v442': resolve('scripts/fixtures/ui-refinement-v442.ts'),
    'ui-refinement-enemy-v442': resolve('scripts/fixtures/ui-refinement-enemy-v442.ts'),
  },
  output: { path: output, filename: '[name].js', clean: true },
  resolve: { extensions: ['.ts', '.js'] },
  module: { rules: [
    { test: /\.ts$/, loader: 'ts-loader', options: { transpileOnly: true, compilerOptions: { module: 'esnext' } }, exclude: /node_modules/ },
    { test: /\.scss$/, use: [MiniCssExtractPlugin.loader, { loader: 'css-loader', options: { url: false } }, 'sass-loader'] },
  ] },
  plugins: [new MiniCssExtractPlugin({ filename: '[name].css' })],
}, (error, stats) => error || stats?.hasErrors()
  ? fail(error || Error(stats?.toString({ all: false, errors: true })))
  : ok()));

fs.writeFileSync(resolve(output, 'index.html'), `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>UI refinement v442 QA fixture</title><link rel="stylesheet" href="ui-refinement-v442.css">
<style>
body{padding:20px}.fixture{max-width:1180px;margin:auto;display:grid;gap:18px}.fixture-panel{padding:18px;border:1px solid var(--border);border-radius:14px;background:var(--surface);color:var(--text)}.fixture-panel h1,.fixture-panel h2{margin:0 0 8px}.fixture-toolbar{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.fixture-toolbar button{padding:7px 11px;border:1px solid var(--border-strong);border-radius:7px;background:var(--accent-soft);color:var(--text);cursor:pointer}.fixture-toolbar button:hover{background:var(--accent);color:var(--surface)}.fixture-note{color:var(--text-muted)}.fixture-deck{width:100%;min-height:92px;padding:9px;border:1px solid var(--border-strong);border-radius:8px;background:var(--surface-muted);color:var(--text)}.fixture-deck-value{white-space:pre-wrap;padding:8px;border-left:3px solid var(--accent);color:var(--text)}
</style></head><body><main class="fixture mwg-section-fold">
<section class="fixture-panel"><h1>v442 UI QA 夹具</h1><p class="fixture-note">本页只使用内存中的演示数据；不会读取或写入 Tavern 变量、存档或真实战斗。</p></section>
<section id="tower-start-panel" class="fixture-panel tower-start-panel" aria-label="爬塔开局设置"><h2>共享基础机制选择器与自定义卡组文本</h2><textarea id="tower-start-card" class="fixture-deck" aria-label="自定义卡组文本" placeholder="可以直接输入自定义卡组文本"></textarea><p class="fixture-note">当前文本：</p><output id="fixture-deck-value" class="fixture-deck-value">（空）</output><div id="tower-archetype-picker"></div></section>
<section class="fixture-panel"><h2>实际战利品交易</h2><p id="fixture-reward-state" class="fixture-note"></p><div class="fixture-toolbar"><button id="fixture-reset" type="button">重置战利品</button><button id="fixture-clear" type="button">清空未领取战利品</button></div><div id="choice-container" class="is-battle-reward-menu"><section id="fixture-rewards" class="reward-card"></section></div></section>
<section class="fixture-panel"><h2>实际三入口塔地图</h2><p class="fixture-note">固定 seed 442；初始三个入口已在内存中标记为 ready。点击任一入口只调用内存的 enterRunNode，并立即重绘地图。</p><output id="fixture-map-state" class="fixture-deck-value"></output><div id="fixture-map"></div></section>
<section class="fixture-panel"><h2>实际敌人意图与姿态中文</h2><p class="fixture-note">Fish 战斗夹具位于独立文档，避免其全局卡牌点击处理器影响 Common 奖励操作。</p><a href="enemy.html" target="_blank" rel="noopener">打开独立敌人夹具</a></section>
</main><script src="ui-refinement-v442.js"></script></body></html>`);
fs.writeFileSync(resolve(output, 'enemy.html'), `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>UI refinement v442 enemy QA fixture</title><link rel="stylesheet" href="ui-refinement-enemy-v442.css"></head><body>
<div class="card-game-container"><div id="battle-scene" class="scene"><div class="top-info-bar"><div id="turn-number"></div><div id="phase-indicator"></div></div><div class="battle-main-grid"><section class="enemy-section"><div class="enemy-title-bar"><div class="enemy-avatar-stack"><div class="enemy-emoji">👹</div></div><div id="enemy-name" class="enemy-name"></div><div class="enemy-intent" role="button"><div class="intent-text"></div></div></div><div id="enemy-roster" class="enemy-roster"></div><div class="enemy-card"><div class="character-stats"><div class="stat-item hp-stat"><div class="stat-bar-container"><div class="stat-bar-bg hp-bg"><div class="stat-bar-fill hp-fill"></div></div><div id="enemy-hp" class="stat-text"></div></div></div><div class="stat-item lust-stat"><div class="stat-bar-container"><div class="stat-bar-bg lust-bg"><div class="stat-bar-fill lust-fill"></div></div><div id="enemy-lust" class="stat-text"></div></div></div><div id="enemy-block-container"><span id="enemy-block"></span></div><div id="enemy-combat-resources"></div></div><div id="enemy-status-effects"></div><div id="enemy-abilities"></div><div id="enemy-special-containers" class="special-containers"></div><div id="enemy-lust-effect"></div></div></section><div id="battle-stage" class="battle-stage"><div id="stage-player" class="stage-combatant stage-player"><div id="stage-player-emoji" class="stage-emoji">✨</div></div><div id="stage-enemy" class="stage-combatant stage-enemy"><div id="stage-enemy-party" class="stage-enemy-party"></div></div><div id="player-summons"></div><div id="enemy-summons"></div></div></div><div class="player-section"><div class="player-emblem"></div><div class="player-card"><div class="hp-fill"></div><div id="player-hp"></div><div class="lust-fill"></div><div id="player-lust"></div><div id="player-energy"></div><div id="player-combat-resources"></div><div id="block-stat-container"><span id="player-block"></span></div><div class="relic-grid"></div><div id="player-status-effects"></div><div id="player-abilities"></div><div id="player-special-containers"></div><div id="player-lust-effect"></div></div></div><div id="hand-cards" class="player-hand"></div><div id="deck-pile-count"></div><div id="draw-pile-count"></div><div id="discard-pile-count"></div><div id="exhaust-pile-count"></div><button class="end-turn-button"></button><button id="use-item-btn"></button></div></div>
<script src="ui-refinement-enemy-v442.js"></script></body></html>`);
console.log(`Built ${resolve(output, 'index.html')}`);
