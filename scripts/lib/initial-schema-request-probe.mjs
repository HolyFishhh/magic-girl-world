// Pure, read-only interpretation of tab-scoped CDP request events. Return only
// bounded metadata and a schema digest, never request bodies/headers/settings.
export async function summarizeInitialSchemaRequest(event) {
  if (event?.method !== 'Network.requestWillBeSent') return null;
  const request = event.params?.request;
  if (request?.method !== 'POST' || typeof request.postData !== 'string') return null;
  let url;
  try { url = new URL(request.url); } catch { return null; }
  if (url.origin !== 'http://127.0.0.1:8012' || url.pathname !== '/api/backends/chat-completions/generate') return null;
  let payload;
  try { payload = JSON.parse(request.postData); } catch { return null; }
  if (!Array.isArray(payload?.messages)) return null;
  // Helper may merge adjacent system messages. Match one complete owned line,
  // not the entire combined message and not an embedded/quoted substring.
  const markers = payload.messages.filter(message => message?.role === 'system' && typeof message.content === 'string')
    .flatMap(message => message.content.replace(/\r\n/g, '\n').split('\n'))
    .filter(line => /^MWG_TOWER_STRUCTURED_REQUEST:mwg-single-floor-start-\d+-\d+__draft(?:_empty_retry)?$/.test(line));
  if (markers.length !== 1) return null;
  const shared = payload.messages.filter(message => message?.role === 'system' &&
    typeof message.content === 'string' && message.content.startsWith('[MWG_RESPONSE_SCHEMA/v1]\n'));
  const tools = Array.isArray(payload.tools) ? payload.tools : [];
  const tool = tools.length === 1 && tools[0]?.type === 'function'
    && tools[0]?.function?.name === 'submit_initial_draft' ? tools[0].function : null;
  const toolContract = shared.length === 0 && !payload.json_schema && tool?.parameters
    && typeof tool.parameters === 'object' && !Array.isArray(tool.parameters);
  const promptContract = shared.length === 1 && tools.length === 0;
  const result = {
    requestId: String(event.params.requestId).slice(0, 100),
    generationId: markers[0].split(':')[1],
    source: payload.chat_completion_source === 'deepseek' ? 'deepseek' : 'other',
    model: String(payload.model || '').slice(0, 100),
    schemaName: typeof payload.json_schema?.name === 'string' ? payload.json_schema.name.slice(0, 100) : null,
    nativeJsonModeRequested: Boolean(payload.json_schema),
    thinkingEnabled: typeof payload.include_reasoning === 'boolean' ? payload.include_reasoning : null,
    maximumReplyTokens: Number.isSafeInteger(payload.max_tokens) && payload.max_tokens > 0 ? payload.max_tokens : null,
    streamRequested: typeof payload.stream === 'boolean' ? payload.stream : null,
    sharedContractCount: shared.length,
    toolCount: Math.min(tools.length, 100),
    toolChoice: ['auto', 'none', 'required'].includes(payload.tool_choice) ? payload.tool_choice
      : payload.tool_choice == null ? null : 'other',
    contractChannel: toolContract ? 'tool' : promptContract ? 'prompt' : null,
    sharedPromptCharacters: shared.reduce((sum, message) => sum + message.content.length, 0),
    schemaOutlineCharacters: payload.json_schema ? JSON.stringify(payload.json_schema.value, null, 4).length : 0,
    // Expansion/digest alone is not canonical contract verification. The
    // evidence consumer must compare the digest with the local full schema.
    schemaDigestComputed: false,
  };
  if (!toolContract && !promptContract) return result;
  try {
    const document = toolContract ? tool.parameters : JSON.parse(shared[0].content.split('\n').at(-1));
    const { $defs, ...root } = document;
    let visited = 0;
    const expand = (value, refs = new Set(), depth = 0) => {
      if (++visited > 100_000 || depth > 64) throw new Error('bounded expansion');
      if (Array.isArray(value)) return value.map(child => expand(child, refs, depth + 1));
      if (!value || typeof value !== 'object') return value;
      if (Object.keys(value).length === 1 && /^#\/\$defs\/S\d+$/.test(value.$ref || '')) {
        const id = value.$ref.split('/').at(-1);
        if (refs.has(id) || !$defs || !Object.hasOwn($defs, id)) throw new Error('invalid reference');
        return expand($defs[id], new Set([...refs, id]), depth + 1);
      }
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, expand(child, refs, depth + 1)]));
    };
    const complete = expand(root);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(complete)));
    return { ...result, schemaDigestComputed: true,
      completeSchemaSha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''),
      completeSchemaPrettyCharacters: JSON.stringify(complete, null, 4).length,
      definitions: Object.keys($defs || {}).length };
  } catch { return result; }
}
