export type GenerationTransportFailureKind = 'quota' | 'authentication' | 'permission' | 'request' | 'rate_limit' | 'server' | 'route_changed';
export interface GenerationTransportFailure {
  kind: GenerationTransportFailureKind;
  httpStatus?: number;
  retryable: boolean;
  evidence: 'response' | 'proxy_response' | 'exception' | 'request_guard';
  /** Explicit upstream rejection, not a guess from invalid game content. */
  unsupportedResponseFormat?: true;
}

const messages: Record<GenerationTransportFailureKind, string> = {
  route_changed: '模型渠道在请求发送前发生变化，本次请求已停止；请确认当前渠道后重试。',
  quota: '模型接口余额或额度不足，请恢复当前接口后重试；这不是 MVU 格式错误。',
  authentication: '模型接口鉴权失败，请检查当前接口的登录或密钥配置后重试。',
  permission: '模型接口拒绝访问，请检查当前账号或模型的使用权限后重试。',
  request: '模型接口拒绝了请求，请检查模型、接口地址和请求参数；未进入 MVU 内容修复。',
  rate_limit: '模型接口请求过于频繁，请稍后重试；当前存档不会被失败结果覆盖。',
  server: '模型接口请求失败，请检查酒馆的接口错误详情后重试；仅凭状态码无法确定上游原因。',
};

/** Store only controlled diagnostic fields, never provider bodies, credentials,
 * arbitrary exception messages or the original error as a serializable cause. */
export class GenerationTransportError extends Error {
  readonly code = 'generation_transport';
  constructor(public readonly failure: GenerationTransportFailure) {
    super(`${messages[failure.kind]}${failure.httpStatus ? `（HTTP ${failure.httpStatus}）` : ''}`);
    this.name = 'GenerationTransportError';
  }
}

function textField(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 2048).toLowerCase() : '';
}

/** Called only for actual HTTP errors or a recognized proxy error envelope.
 * Never infer a quota problem from a generic HTTP 500. */
export function classifyGenerationTransportFailure(
  status: number | undefined,
  body?: unknown,
  evidence: GenerationTransportFailure['evidence'] = 'response',
): GenerationTransportFailure {
  const validStatus = Number.isInteger(status) && status! >= 400 && status! <= 599 ? status : undefined;
  let code = '', message = '';
  try {
    const root = body as Record<string, any> | null;
    const detail = root?.error && typeof root.error === 'object' ? root.error : root;
    code = textField(detail?.code || detail?.type);
    message = textField(detail?.message);
  } catch { /* Opaque/getter-bearing errors are not trusted metadata. */ }
  let kind: GenerationTransportFailureKind;
  if (validStatus === 402
    || ['insufficient_quota', 'insufficient_balance', 'credit_balance_too_low', 'billing_hard_limit_reached', 'billing_not_active'].includes(code)
    || /insufficient (?:balance|credits)|credit balance is too low|exceeded your current quota|余额不足/.test(message)) kind = 'quota';
  else if (validStatus === 401 || ['invalid_api_key', 'authentication_error', 'invalid_authentication'].includes(code)) kind = 'authentication';
  else if (validStatus === 403 || code === 'permission_denied') kind = 'permission';
  else if (validStatus === 429 || code === 'rate_limit_exceeded') kind = 'rate_limit';
  else if ((validStatus !== undefined && validStatus < 500)
    || ['invalid_request_error', 'context_length_exceeded', 'model_not_found', 'unsupported_parameter'].includes(code)) kind = 'request';
  else kind = 'server';
  const unsupportedResponseFormat = kind === 'request' && [400, 422].includes(validStatus!)
    && ['invalid_request_error', 'unsupported_parameter'].includes(code)
    && message.trim() === 'this response_format type is unavailable now';
  return { kind, ...(validStatus ? { httpStatus: validStatus } : {}),
    retryable: kind === 'rate_limit' || (kind === 'server' && validStatus !== undefined && validStatus >= 500), evidence,
    ...(unsupportedResponseFormat ? { unsupportedResponseFormat: true as const } : {}) };
}

/** Some OpenAI proxies wrap an upstream error in a successful completion.
 * Require the complete known wrapper, one assistant choice and a JSON error;
 * a mention in prose or inside a valid game object is never sufficient. */
export function readProxyGenerationFailure(body: unknown): GenerationTransportFailure | undefined {
  try {
    const root = body as Record<string, any> | null;
    if (!Array.isArray(root?.choices) || root.choices.length !== 1) return;
    const message = root.choices[0]?.message;
    if (message?.role !== 'assistant' || message.tool_calls || message.function_call
      || typeof message.content !== 'string' || message.content.length > 8192) return;
    const text = message.content.replace(/\r\n/g, '\n').trim();
    const match = text.match(/^### \*\*Proxy error \(HTTP ([45]\d{2}) [^\n]*\)\*\*\n\nThe proxy encountered an error while trying to send your prompt to the API\. Further details are provided below\.\n[\s\S]*?\n```(?:json)?\n([^`]+)\n```\s*<!-- oai-proxy-error -->$/);
    if (!match) return;
    const detail = JSON.parse(match[2]);
    // Proxy diagnostic metadata is optional. The full anchored wrapper and
    // its error object establish provenance, not provider-specific extra keys.
    if (!detail?.error || typeof detail.error !== 'object' || Array.isArray(detail.error)
      || typeof detail.error.message !== 'string') return;
    return classifyGenerationTransportFailure(Number(match[1]), detail, 'proxy_response');
  } catch { return; }
}

export function normalizeGenerationTransportError(error: unknown): unknown {
  if (error instanceof GenerationTransportError) return error;
  try {
    const candidate = error as { name?: unknown; code?: unknown; status?: unknown; message?: unknown } | null;
    if (candidate?.name === 'AbortError' || candidate?.code === 'cancelled' || candidate?.code === 'timeout') return error;
    const message = typeof candidate?.message === 'string' ? candidate.message : '';
    const match = message.match(/(?:Got response status|\bHTTP)\s+([45]\d{2})(?:\b|:)/);
    const status = typeof candidate?.status === 'number' ? candidate.status : match ? Number(match[1]) : undefined;
    if (status !== undefined && Number.isInteger(status) && status >= 400 && status <= 599) {
      return new GenerationTransportError(classifyGenerationTransportFailure(status, undefined, 'exception'));
    }
  } catch { /* Preserve the original error if it cannot be safely inspected. */ }
  return error;
}
