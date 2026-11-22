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

// The standard Ark product and its subscription share an origin but use distinct credentials.
export function credentialScope(address: string) {
  try {
    const url = new URL(address);
    if (url.origin === new URL(compatibleBases.ark).origin && /^\/api\/plan(?:\/|$)/.test(url.pathname))
      return compatibleBases.arkPlan;
    return url.origin;
  } catch { return undefined; }
}
