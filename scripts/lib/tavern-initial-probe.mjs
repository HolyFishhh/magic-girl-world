// Run only through the browser product's explicitly provided, tab-scoped
// development capability. These expressions use public reads / existing UI
// handlers; they never replace MVU, patch a controller, or fake model output.
const fields = {
  name:'tower-start-name', profession:'tower-start-profession',
  customDescription:'tower-start-description', world:'tower-start-world',
  opening:'tower-start-opening', card:'tower-start-card', towerRequirements:'tower-start-requirements',
};
const chatGuard = chatId => {
  if (typeof chatId !== 'string' || !chatId.trim()) throw new Error('exact test chat required');
};

export function startTowerFormExpression(chatId, config) {
  chatGuard(chatId);
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || Object.keys(config).some(key => !Object.hasOwn(fields,key))
    || Object.values(config).some(value => typeof value !== 'string' || value.length > 4000)) {
    throw new Error('only bounded, authored form fields are accepted');
  }
  const start = (expectedChat, values, fieldIds) => {
    const context = SillyTavern.getContext();
    if (context.chatId !== expectedChat || context.chat.length !== 1 || context.chat[0].is_user) {
      throw new Error('exact first assistant test floor required');
    }
    const root = Mvu.getMvuData({type:'message',message_id:0});
    if (root?.stat_data?.run || root?.mwg_tower_initial_commit) throw new Error('existing initial state must not be replaced');
    if (root?.stat_data?.game_mode_lock?.mode !== 'tower') throw new Error('select the real tower greeting first');
    if (MagicGirlDesignAssistant.getTowerInitialPublicationStatus().busy) throw new Error('initial generation already active');
    const doc = document.querySelector('iframe[name="TH-message--0--0"]')?.contentDocument;
    const button = doc?.getElementById('tower-start-button');
    if (!button || button.disabled) throw new Error('start form not ready');
    // Validate the complete form before mutating even one input.
    const controls = Object.entries(fieldIds).map(([key,id]) => {
      const control = doc.getElementById(id);
      if (!control || control.disabled) throw new Error(`form input unavailable: ${key}`);
      return [key,control];
    });
    for (const [key,control] of controls) {
      control.value = values[key] || '';
      control.dispatchEvent(new Event('input',{bubbles:true}));
    }
    // Filling form controls must not race a user switching to another save.
    if (SillyTavern.getContext().chatId !== expectedChat) throw new Error('test chat changed');
    button.click();
    return {chatId:expectedChat,dispatched:true,note:'UI dispatch only; model and disk success must be verified separately'};
  };
  return `(${start.toString()})(${JSON.stringify(chatId)},${JSON.stringify(config)},${JSON.stringify(fields)})`;
}

export function initialProbeSnapshotExpression(chatId) {
  chatGuard(chatId);
  const read = expectedChat => {
    const context = SillyTavern.getContext();
    if (context.chatId !== expectedChat) throw new Error('test chat changed');
    const root = Mvu.getMvuData({type:'message',message_id:0});
    const monitor = MagicGirlWorld.getMvuMonitorSnapshot();
    const receipt = root?.mwg_tower_initial_commit;
    const publication = context.chatMetadata?.mwg_tower_initial_publication;
    const gate = MagicGirlDesignAssistant.getTowerInitialPublicationStatus();
    const receiptMatches = receipt?.chatId === expectedChat && receipt?.messageId === 0;
    const published = receiptMatches && publication?.spec === 'mwg.tower-initial-publication/v1'
      && publication.chatId === expectedChat && publication.messageId === 0
      && publication.swipeId === Number(context.chat[0]?.swipe_id ?? 0)
      && publication.generationId === receipt.generationId && publication.stateDigest === receipt.stateDigest
      && gate.ready === true && gate.busy === false;
    return {
      chatId:expectedChat,phase:published ? 'published-in-memory' : monitor.phase,
      generationId:receiptMatches ? receipt.generationId : monitor.generationId,
      detail:monitor.detail,startedAt:monitor.startedAt,finishedAt:monitor.finishedAt,
      timeline:monitor.timeline.map(({label,detail,at})=>({label,detail,at})),gate,
      cardQuantity:root?.stat_data?.battle?.cards?.reduce((n,card)=>n+Number(card.quantity??1),0)??0,
      coordinatorPhase:MagicGirlDesignAssistant.getTowerCoordinatorStatus()?.phase,
      requiresDiskVerification:true,
    };
  };
  return `(${read.toString()})(${JSON.stringify(chatId)})`;
}
