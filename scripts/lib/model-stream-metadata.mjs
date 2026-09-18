// Metadata only. Never return reasoning/content fragments, IDs, arbitrary
// error messages, tool arguments, headers or provider signatures.
export function summarizeModelEventStream(text) {
  if(typeof text!=='string'||text.length>32*1024*1024)throw new Error('bounded SSE text required');
  const result={events:0,parseErrors:0,contentCharacters:0,reasoningCharacters:0,
    toolArgumentCharacters:0,toolDeltaCount:0,finishReasons:[],done:false,usage:{}};
  const finishes=new Set();
  const accept=value=>{
    if(value==='[DONE]'){result.done=true;return;}
    if(!value)return;
    let chunk;try{chunk=JSON.parse(value);}catch{result.parseErrors++;return;}
    result.events++;
    for(const choice of Array.isArray(chunk?.choices)?chunk.choices:[]){
      if(typeof choice.delta?.content==='string')result.contentCharacters+=choice.delta.content.length;
      if(typeof choice.delta?.reasoning_content==='string')result.reasoningCharacters+=choice.delta.reasoning_content.length;
      for(const tool of Array.isArray(choice.delta?.tool_calls)?choice.delta.tool_calls:[]){
        result.toolDeltaCount++;
        if(typeof tool.function?.arguments==='string')result.toolArgumentCharacters+=tool.function.arguments.length;
      }
      if(choice.finish_reason!=null)finishes.add(['stop','length','tool_calls','content_filter','insufficient_system_resource']
        .includes(choice.finish_reason)?choice.finish_reason:'other');
    }
    for(const field of ['prompt_tokens','completion_tokens','total_tokens']){
      if(Number.isSafeInteger(chunk?.usage?.[field])&&chunk.usage[field]>=0)result.usage[field]=chunk.usage[field];
    }
    const reasoning=chunk?.usage?.completion_tokens_details?.reasoning_tokens;
    if(Number.isSafeInteger(reasoning)&&reasoning>=0)result.usage.reasoning_tokens=reasoning;
  };
  let data=[];
  for(const line of text.split(/\r\n|\r|\n/)){
    if(!line){if(data.length)accept(data.join('\n').trim());data=[];continue;}
    if(line==='data')data.push('');
    else if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''));
  }
  if(data.length)accept(data.join('\n').trim());
  result.finishReasons=[...finishes];
  return result;
}
