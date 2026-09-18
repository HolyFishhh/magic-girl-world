/** Aggregate independently verified evidence, never generated descriptions.
 * This pure tally does not verify evidence provenance or replace gameplay tests.
 * Callers must bind every row to the frozen candidate and actual saved chat.
 */
export function summarizeFixedOpenings(expectedIds, rows) {
  if (!Array.isArray(expectedIds) || expectedIds.length !== 5 || new Set(expectedIds).size !== 5
    || expectedIds.some(id=>typeof id!=='string'||!id)) throw Error('Exactly five unique frozen scenario IDs required');
  if (!Array.isArray(rows)) throw Error('Evidence rows required');
  const byId=new Map();
  for(const row of rows) {
    if (!expectedIds.includes(row.id) || byId.has(row.id)) throw Error('Unknown or duplicate scenario evidence');
    if (!['pass','fail','unverified'].includes(row.semantics)) throw Error('Explicit semantic verdict required');
    if (typeof row.published!=='boolean'||typeof row.persisted!=='boolean') throw Error('Explicit publication/persistence evidence required');
    if (row.mechanismCalls!==null && (!Number.isSafeInteger(row.mechanismCalls)||row.mechanismCalls<1)) throw Error('Calls must be observed positive count or null');
    byId.set(row.id,row);
  }
  const completed=rows.filter(r=>r.published&&r.persisted&&r.semantics==='pass').length;
  const published=rows.filter(r=>r.published).length;
  const knownAdditional=rows.reduce((n,r)=>n+(r.mechanismCalls===null?0:r.mechanismCalls-1),0);
  const countsComplete=rows.length===5&&rows.every(r=>r.mechanismCalls!==null);
  const failed=rows.filter(r=>!r.published||!r.persisted||r.semantics==='fail').length;
  const verdict=failed>0||knownAdditional>1?'fail'
    :completed===5&&countsComplete?'pass':'unverified';
  return {scope:'five-opening-evidence-tally',evidenceProvenanceVerified:false,
    expected:5,observed:rows.length,published,completed,completionRate:completed/5,
    additionalMechanismCalls:countsComplete?knownAdditional:null,
    observedAdditionalLowerBound:knownAdditional,
    additionalRate:countsComplete?knownAdditional/5:null,verdict,
    missingIds:expectedIds.filter(id=>!byId.has(id)),
    semanticFailures:rows.filter(r=>r.semantics==='fail').map(r=>r.id),
    unverifiedIds:expectedIds.filter(id=>!byId.has(id)||byId.get(id).semantics==='unverified'),
    overallProjectUsability:'unproven'};
}
