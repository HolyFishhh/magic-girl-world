# Run Settlement Boundaries

The route state and node settlement rules are host-neutral. Tavern code only
reads and writes the MUV-shaped object around these plans.

## Core plans

- `planProgressionSettlement()` computes normalization, multi-level promotion,
  and even-level card-removal grants without mutating input.
- `planRestHeal()` validates an active rest node and computes clamped HP plus
  the completed route state.
- `planShopPurchase()` validates selections, computes program-owned prices,
  rejects insufficient gold, and completes the shop route atomically.
- `formatRestUpgradePrompt()` projects one stable card into the compact
  AI-authored upgrade request without exposing host-only fields.
- `requireActiveRunNode()` is the shared active-node precondition used by
  event, rest, shop, and generic route completion rules.

All plans return plain JSON-compatible data and import no MUV, Tavern Helper,
DOM, or SillyTavern APIs.

## Tavern adapter

`src/common/progression.ts` applies the progression plan to `battle.level`,
`battle.exp`, and `battle.core.card_removal_count`. `src/common/runTransactions.ts` reads MUV arrays, clones the
save, applies rewards, strips shop prices, and writes the plan result only
after all validation succeeds.

`src/common/runActionHost.ts` is the single Tavern application host above
those adapters. It owns route prepare/rollback, pending event and campfire
settlement, reward routing, rest/shop/restart/card-removal mutations, and
delegation to the structured continuation host. `src/common/index.ts` only
renders controls and consumes the host's structured result.

This keeps route arithmetic reusable by a website or Mod while preserving the
all-or-nothing MUV behavior.
