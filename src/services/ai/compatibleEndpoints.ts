// Preserve the configured product prefix. Never infer a generation URL from a model-list fallback.
export const compatibleBases = {
  qianfan: 'https://qianfan.baidubce.com/v2',
  ark: 'https://ark.cn-beijing.volces.com/api/v3',
  arkPlan: 'https://ark.cn-beijing.volces.com/api/plan/v3',
  openrouter: 'https://openrouter.ai/api/v1',
};

export function compatibleBase(url: string) {
  const parsed = new URL(url);
  return parsed.origin + parsed.pathname.replace(/\/+$/, '').replace(/\/(?:chat\/completions|models)$/i, '');
}

// A gateway may mount the subscription under a prefix or add its own path after the version.
export function arkPlanScope(url: URL) {
  const prefix = url.pathname.match(/^(.*?\/api\/plan)(?:\/|$)/i)?.[1];
  return prefix ? url.origin + prefix : undefined;
}

// The standard Ark product and its subscription share an origin but use distinct credentials.
export function credentialScope(address: string) {
  try {
    const url = new URL(address);
    return arkPlanScope(url) ?? url.origin;
  } catch { return undefined; }
}
