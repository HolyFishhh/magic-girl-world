export function summarizeCards(cards) {
  return Array.isArray(cards)
    ? cards.map(card => ({
        id: card?.id,
        name: card?.name,
        cost: card?.cost,
        doubleEffect: card?.doubleEffect === true || undefined,
      }))
    : null;
}

export function summarizeBattleSnapshot(snapshot) {
  const enemy = snapshot?.state?.enemy;

  return {
    currentTurn: snapshot?.state?.currentTurn,
    phase: snapshot?.state?.phase,
    randomSeed: snapshot?.state?.random?.seed,
    randomCursor: snapshot?.state?.random?.cursor,
    requestNodeId: snapshot?.state?.battleRequest?.route?.nodeId ?? null,
    currentHp: snapshot?.state?.player?.currentHp,
    currentHpType: typeof snapshot?.state?.player?.currentHp,
    energy: snapshot?.state?.player?.energy,
    block: snapshot?.state?.player?.block,
    enemyHp: enemy?.currentHp,
    enemyBlock: enemy?.block,
    enemyIntent: enemy?.nextAction?.name ?? enemy?.intent?.name,
    enemySequenceIndex: enemy?._sequenceIndex ?? enemy?.sequenceIndex,
    enemySequenceDoneOnce: enemy?._sequenceDoneOnce ?? enemy?.sequenceDoneOnce,
    cardsPlayedThisTurn: snapshot?.state?.cardsPlayedThisTurn,
    attacksPlayedThisTurn: snapshot?.state?.attacksPlayedThisTurn,
    skillsPlayedThisTurn: snapshot?.state?.skillsPlayedThisTurn,
    hand: summarizeCards(snapshot?.state?.player?.hand),
    drawPile: summarizeCards(snapshot?.state?.player?.drawPile),
    discardPile: summarizeCards(snapshot?.state?.player?.discardPile),
    exhaustPile: summarizeCards(snapshot?.state?.player?.exhaustPile),
  };
}

export function summarizeMvuBattle(battle) {
  return {
    coreHp: battle?.core?.hp,
    coreMaxHp: battle?.core?.max_hp,
    cardCount: Array.isArray(battle?.cards) ? battle.cards.length : null,
    enemyName: battle?.enemy?.name,
    enemyHp: battle?.enemy?.hp,
    enemyMaxHp: battle?.enemy?.max_hp,
    enemyBlock: battle?.enemy?.block,
    enemyActionMode: battle?.enemy?.action_mode,
    enemyActionNames: Array.isArray(battle?.enemy?.actions)
      ? battle.enemy.actions.map(action => action?.name)
      : null,
    enemyActionConfig: battle?.enemy?.action_config,
  };
}
