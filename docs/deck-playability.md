# Deck Playability Boundary

## Purpose

Deck diagnostics are warnings for content authors. They are not a combat
simulator and must never reject a creative deck only because the estimate is
uncertain.

The first AI response is a narrower exception. Before floor 1 is exposed,
`playerContentReadiness.ts` requires the explicit initialization contract:
at least ten total cards, a card playable with base energy, a victory path,
defense or recovery, one relic, one item, a player desire-overflow effect, and
valid initial vitals/progression. This gate runs only at floor 0; later player
deck-building choices are not rejected for becoming small or unconventional.

## Shared implementation

`src/game-core/deckPlayability.ts` owns the minimum rules:

- quantity is summed from valid positive integers (an omitted quantity is 1);
- a non-Curse card is playable on a normal turn when its numeric cost is at
  most the base energy (3 by default), or when its cost is `energy`;
- an Event is an explicit battle-ending pressure path;
- attack, defense, sustain, and formula-driven dynamic metrics come from the
  shared `ContentAnalysis` result.

The shared `hasContentMetric()` predicate in `contentAnalysis.ts` is also used
by enemy-budget diagnostics and Tavern enemy preflight, so positive and
formula-driven pressure has one definition. The function returns a flat
`DeckPlayabilityAssessment`. It does not import
MUV, Tavern Helper, DOM APIs, or SillyTavern globals.

## Host responsibilities

Tavern preflight normalizes the MUV card list, analyzes each executable card
with the shared content-analysis pass, and passes the resulting summaries to
`assessDeckPlayability`. It only maps the four booleans and quantity to
localized warning text. A website or a Mod can call the same core function
without importing `src/fish`, `src/common`, or runtime adapters.

## Verification

`scripts/test-deck-playability.mjs` covers quantity merging, base-energy
affordability, Curse exclusion, Event pressure, and formula-driven attack.
`scripts/test-player-content-readiness.mjs` covers the floor-0 gate, bounded
repair prompt, modern field failures, missing resources, and invalid vitals.
The release pipeline runs both through the shared content-contract gate.

## Related host boundary cleanup

The MagVarUpdate array wrapper is shared by `src/runtime/mvuArrays.ts`.
Tavern battle conversion and common reward/run transactions use that helper;
neither module keeps a second marker set or recursive flattener.
