import {
  PORTABLE_API_SPEC,
  compileCompactEffectList,
  createContentPack,
  validateContentPackContract,
  type EffectProgram,
} from '@magic-girl-world/portable-core/card';
import {
  ReferenceBattleRuntimeHost,
  createBattleFingerprint,
  createBattleRandomState,
  createBattleSessionSnapshot,
  createEmptyBattleState,
  type GameState,
} from '@magic-girl-world/portable-core/battle';

const compiled = compileCompactEffectList({ damage: 8 });
if (!compiled.ok) throw new Error(compiled.issues[0]?.message || 'compile failed');
const program: EffectProgram = compiled.value;

const pack = createContentPack({ cards: [] });
validateContentPackContract(pack);

const initial: GameState = {
  ...createEmptyBattleState(),
  random: createBattleRandomState(1),
};
const host = new ReferenceBattleRuntimeHost(initial);
const fingerprint = createBattleFingerprint({ cards: [], enemy: null });
createBattleSessionSnapshot(fingerprint, host.getGameState(), 1);

void PORTABLE_API_SPEC;
void program;
