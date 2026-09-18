// Expression for the product-provided, origin-scoped browser development tool.
// Drives existing UI handlers only. No state patches, fake victories or model mocks.
export function cardActionsExpression(chatId, nodeId, cardIds, endTurn = false) {
  if (typeof chatId !== 'string' || !chatId || typeof nodeId !== 'string' || !nodeId || typeof endTurn !== 'boolean'
    || !Array.isArray(cardIds) || cardIds.length > 6
    || cardIds.some(id => typeof id !== 'string' || !id)) throw new Error('explicit test scope and bounded card IDs required');
  const action = async (expectedChat, expectedNode, ids, end) => {
    const root = () => Mvu.getMvuData({ type:'message', message_id:0 });
    const read = () => root().__magic_girl_world?.battle_session?.state;
    const guard = () => {
      if (SillyTavern.getContext().chatId !== expectedChat || root()?.stat_data?.run?.currentNode?.id !== expectedNode) {
        throw new Error('test chat or battle node changed');
      }
    };
    const doc = () => document.querySelector('iframe[name="TH-message--0--0"]').contentDocument;
    const wait = () => new Promise(resolve => setTimeout(resolve,100));
    guard();
    for (const id of ids) {
      guard();
      if (read()?.isGameOver) break;
      if (read()?.phase !== 'player_turn') throw new Error('not a player action window');
      const card = [...doc().querySelectorAll('[data-card-id]')].find(element => element.getAttribute('data-card-id') === id);
      if (!card?.classList.contains('clickable')) throw new Error(`card unavailable: ${id}`);
      card.click(); card.click();
      let settled = false;
      for (let i=0;i<60;i++) {
        await wait(); guard();
        const state = read();
        if (!state || state.isGameOver || !state.player.hand.some(entry => entry.id === id)) { settled=true; break; }
      }
      if (!settled) throw new Error(`card not settled: ${id}`);
    }
    if (end && !read()?.isGameOver) {
      guard();
      if (read()?.phase !== 'player_turn') throw new Error('not a player action window');
      const turn = read().currentTurn;
      const button = [...doc().querySelectorAll('button')].find(element => element.textContent.trim() === '结束回合');
      if (!button || button.disabled) throw new Error('end turn unavailable');
      button.click();
      let settled = false;
      for (let i=0;i<80;i++) {
        await wait(); guard();
        const state = read();
        if (!state || state.isGameOver || state.currentTurn > turn && state.phase === 'player_turn') { settled=true; break; }
      }
      if (!settled) throw new Error('turn has not settled');
    }
    const state = read();
    return JSON.stringify(state ? {round:state.currentTurn,phase:state.phase,result:state.battleResult,
      energy:state.player.energy,hp:state.player.currentHp,enemyHp:state.enemy?.currentHp,enemyBlock:state.enemy?.block,
      hand:state.player.hand.map(card=>({id:card.id,cost:card.cost,description:card.description})),
      summons:state.summons?.living.map(unit=>({id:unit.id,hp:unit.currentHp}))} : {battleSession:'settled'});
  };
  return `(${action.toString()})(${JSON.stringify(chatId)},${JSON.stringify(nodeId)},${JSON.stringify(cardIds)},${JSON.stringify(endTurn)})`;
}
