// These records come from test-real-tavern-tower-mechanism-acceptance.mjs:
// its Helper, MVU and battle settlement are in-memory adapters, not real UI.
const transports = ['legacy', 'shared'];
const categories = ['timeout', 'unmappable', 'invalid_json', 'repair_rejected', 'other'];
const nonNegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const label = value => typeof value === 'string' ? value.slice(0, 200) : 'unknown';
export function projectSchemaExperimentRecord(file, data, since) {
  const start = Date.parse(since);
  if (!Number.isFinite(start)) throw new Error('since must be an ISO date');
  if (data?.spec !== 'mwg.real-tavern-tower-mechanism-acceptance/v1') return { reason:'unsupported_spec' };
  if (data.executionScope !== undefined && data.executionScope !== 'real-model-in-memory-host') return { reason:'unsupported_scope' };
  if (!data.completedAt || !data.summary) return { reason:'incomplete' };
  const began=Date.parse(data.startedAt), ended=Date.parse(data.completedAt);
  if (!Number.isFinite(began) || !Number.isFinite(ended) || ended < began) return { reason:'invalid_time' };
  if (began < start) return { reason:'before_window' };
  if (typeof data.summary.successful !== 'boolean') return { reason:'invalid_summary' };
  const calls=Array.isArray(data.calls)?data.calls:[];
  if (data.replayInitialFrom || calls.some(call=>call?.replayed) || Number(data.summary.replayedModelResponses)>0) return { reason:'replay' };
  if (!transports.includes(data.schemaTransport)) return { reason:'unsupported_transport' };
  const first=calls[0];
  if (!first || first.kind !== 'initial_authoring') return { reason:'no_model_attempt' };
  const repairCalls=calls.filter(call=>typeof call?.kind==='string' && call.kind.includes('repair')).length;
  // Historical harness records contain raw transport data. Inspect locally
  // only for finite token counts; never copy bodies, reasoning or errors out.
  let usage=first.usage;
  if (!usage) { try { usage=JSON.parse(first.rawTransport || '{}').usage; } catch { /* unavailable */ } }
  const error=typeof data.summary.error==='string'?data.summary.error:'';
  const failureCategory=data.summary.successful?null
    : /timeout|exceeded|abort/i.test(error)?'timeout'
      : /无法把全部校验错误映射/.test(error)?'unmappable'
        : /没有返回合法 JSON/.test(error)?'invalid_json'
          : /修复/.test(error)?'repair_rejected':'other';
  const messages=Array.isArray(first.requestBody?.messages)?first.requestBody.messages:[];
  const schema=first.requestBody?.json_schema?.value;
  return { record:{
    file, mode:data.schemaTransport, scenario:label(data.scenarioId), model:label(data.model), preset:label(data.preset),
    workflowCompleted:data.summary.successful,
    workflowCompletedWithoutRepair:data.summary.successful && repairCalls===0,
    repairCalls, firstCallMs:nonNegative(first.elapsedMs),
    promptTokens:nonNegative(usage?.prompt_tokens), completionTokens:nonNegative(usage?.completion_tokens),
    promptCharacters:messages.reduce((sum,message)=>sum+(typeof message?.content==='string'?message.content.length:0),0)
      +(schema?JSON.stringify(schema,null,4).length:0),
    failureCategory,
    // The historical harness did not fingerprint the full dirty source tree.
    // Neither a matching preset/model nor an arbitrary summary flag proves it.
    codeRevisionEvidence:'missing',
  } };
}

export function summarizeSchemaExperiment(records, { since, generatedAt=new Date().toISOString(), skipped={} }) {
  const mean=values=>{const numbers=values.filter(value=>nonNegative(value)!==undefined);
    return numbers.length?Math.round(numbers.reduce((sum,value)=>sum+value,0)/numbers.length):null;};
  return {
    spec:'mwg.schema-transport-experiment-report/v2', since, generatedAt,
    evidenceScope:'real-model-in-memory-host', overallUsability:'unproven', currentVersionReliability:'unproven',
    proves:{nativeHelper:false,presetNarrative:false,liveChatPublication:false,liveBattle:false,liveSaveReload:false,semanticUsability:false},
    note:'Counts describe only the recorded experimental workflow. They are not independent live starts or evidence of playable acceptance, and may span source versions.',
    metricDefinitions:{
      repairCalls:'Number of recorded call.kind labels containing repair; not a count of all model attempts or transport retries.',
      workflowCompletionsWithoutRepair:'Completed workflows with no recorded repair-labelled calls; does not prove retry-free authoring, transport or preset narrative.',
    },
    skipped,
    modes:Object.fromEntries(transports.map(mode=>{
      const rows=records.filter(row=>row.mode===mode);
      return [mode,{
        trials:rows.length,
        workflowCompletions:rows.filter(row=>row.workflowCompleted).length,
        workflowCompletionsWithoutRepair:rows.filter(row=>row.workflowCompletedWithoutRepair).length,
        repairAttempted:rows.filter(row=>row.repairCalls>0).length,
        workflowCompletionsAfterRepair:rows.filter(row=>row.repairCalls>0 && row.workflowCompleted).length,
        failures:Object.fromEntries(categories.map(category=>[category,rows.filter(row=>row.failureCategory===category).length])),
        meanPromptTokens:mean(rows.map(row=>row.promptTokens)), meanFirstCallMs:mean(rows.map(row=>row.firstCallMs)),
        meanPromptCharacters:mean(rows.map(row=>row.promptCharacters)),
      }];
    })),
    records,
  };
}
