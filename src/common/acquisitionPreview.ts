import { applyRewardSelectionsToStat, type RewardSelections, type RewardApplicationOptions } from './rewardTransactions';
import { settleShopSelectionsInStat, settleTowerOpeningChoiceInStat } from './runTransactions';

export interface AcquisitionPreview { stat: Record<string, any>; artifacts: Record<string, any>[] }

/** Use the actual parent transaction to prepare the acquisition selection context.
 * No writes escape the private draft; card identities, payment and opening gains
 * therefore match the eventual commit instead of a second UI implementation. */
export function previewAcquisition(
  stat: Record<string, any>,
  request: { kind: 'opening'; choiceId: string }
    | { kind: 'shop' | 'reward'; selections: RewardSelections; partial?: boolean; cardGroupId?: string },
): AcquisitionPreview {
  const draft = structuredClone(stat);
  let preview: AcquisitionPreview = { stat: draft, artifacts: [] };
  const capture: RewardApplicationOptions['acquisitionPreview'] = (snapshot, artifacts) => {
    preview = { stat: snapshot, artifacts };
  };
  if (request.kind === 'opening') settleTowerOpeningChoiceInStat(draft, request.choiceId, undefined, capture);
  else if (request.kind === 'shop') settleShopSelectionsInStat(draft, request.selections, undefined, capture);
  else applyRewardSelectionsToStat(draft, request.selections, {
    partial: request.partial, cardGroupId: request.cardGroupId, acquisitionPreview: capture,
  });
  return preview;
}
