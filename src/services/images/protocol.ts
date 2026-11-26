import { endpoint, credentialId, imageVault } from './config';
import type { Backend, ImageConfig } from './config';
import { 规范化ComfyUI工作流JSON } from './comfyWorkflow';
import { bounded, decode, maxPictureBytes, rasterMime, unpack } from './raster';
import { 清理生图词组输出 } from './promptTokens';

export const paths = {
  openai: 'images/generations',
  novelai: 'ai/generate-image',
  sd: 'sdapi/v1/txt2img',
  comfy: 'prompt',
};
type JsonMap = Record<string, unknown>;
const obj = (v: unknown): JsonMap => (v && typeof v === 'object' ? (v as JsonMap) : {});
function json(bytes: Uint8Array): JsonMap {
  try {
    return obj(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    throw new Error('接口未返回有效 JSON，请核对 API 路径');
  }
}
async function send(url: string, signal: AbortSignal, key = '', body?: unknown, accept?: string) {
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    signal,
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    headers: {
      ...(key ? { Authorization: 'Bearer ' + key } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(accept ? { Accept: accept } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('接口返回 HTTP ' + response.status);
  }
  return response;
}
export function delay(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
function imageField(v: unknown, depth = 0): string | undefined {
  if (!v || depth > 8) return;
  if (typeof v === 'string') return v;
  const children = Array.isArray(v)
    ? v
    : Object.entries(obj(v))
        .filter(([k]) =>
          [
            'b64_json',
            'base64',
            'image_base64',
            'url',
            'images',
            'image_urls',
            'data',
            'output',
            'image',
            'result',
          ].includes(k),
        )
        .map(([, child]) => child);
  for (const child of children) {
    const hit = imageField(child, depth + 1);
    if (hit) return hit;
  }
}
async function readImage(
  response: Response,
  signal: AbortSignal,
  poll?: { submit: string; key: string },
): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = await bounded(response, Math.ceil(maxPictureBytes * 1.4));
  if (bytes[0] === 80 && bytes[1] === 75) return unpack(bytes);
  try {
    rasterMime(bytes);
    return bytes;
  } catch {
    /* Compatible JSON envelope. */
  }
  const payload = json(bytes);
  const nested = Array.isArray(payload.data) ? obj(payload.data[0]) : obj(payload.data);
  const taskId = payload.task_id ?? payload.taskId ?? nested.task_id ?? nested.taskId;
  if (poll && typeof taskId === 'string' && taskId.length > 0 && taskId.length <= 256) {
    const uri = new URL(poll.submit);
    uri.pathname =
      uri.pathname.replace(/\/images\/(generations|edits)\/?$/i, '') + '/tasks/' + encodeURIComponent(taskId);
    for (let i = 0; i < 60; i++) {
      await delay(1000, signal);
      const result = await bounded(await send(uri.href, signal, poll.key), Math.ceil(maxPictureBytes * 1.4));
      const progress = json(result);
      if (
        /fail|error|cancel|reject|expired/i.test(String(progress.status ?? obj(progress.data).status ?? ''))
      )
        throw new Error('图片异步任务失败');
      if (imageField(progress)) return readImage(new Response(result), signal);
    }
    throw new Error('图片异步任务查询超时');
  }
  const choice = Array.isArray(payload.choices) ? obj(obj(payload.choices[0]).message).content : undefined;
  const image =
    imageField(payload) ??
    (typeof choice === 'string' ? choice.match(/!\[[^\]]*\]\(([^)]+)\)/)?.[1] : undefined);
  if (!image) throw new Error('响应未包含图片');
  if (/^https?:\/\//i.test(image)) {
    const url = new URL(image);
    if (
      url.username ||
      url.password ||
      !(url.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    )
      throw new Error('图片下载地址无效');
    const download = await bounded(await send(url.href, signal), maxPictureBytes);
    rasterMime(download);
    return download;
  }
  return decode(image);
}
export function buildRequest(c: ImageConfig, positive: string, negative: string) {
  const p = c.connections[c.backend],
    [width, height] = p.size.split('x').map(Number);
  if (width < 64 || height < 64 || width * height > 16777216) throw new Error('图片尺寸超出范围');
  const seed = p.seed < 0 ? crypto.getRandomValues(new Uint32Array(1))[0] : p.seed;
  if (c.backend === 'openai') {
    if (!p.model.trim()) throw new Error('请填写图片模型');
    const prompt = [positive, negative && 'Avoid: ' + negative].filter(Boolean).join('\n');
    if (/\/chat\/completions$/i.test('/' + p.path))
      return { model: p.model, stream: false, messages: [{ role: 'user', content: prompt }] };
    return { model: p.model, prompt, size: p.size, n: 1 };
  }
  if (c.backend === 'sd')
    return {
      prompt: positive,
      negative_prompt: negative,
      width,
      height,
      steps: p.steps,
      cfg_scale: p.cfg,
      sampler_name: p.sampler || 'Euler a',
      scheduler: p.scheduler || undefined,
      seed,
      batch_size: 1,
      n_iter: 1,
      ...(p.model
        ? { override_settings: { sd_model_checkpoint: p.model }, override_settings_restore_afterwards: true }
        : {}),
    };
  if (c.backend === 'novelai') {
    if (!p.model.trim()) throw new Error('请填写 NovelAI 模型');
    const caption = (text: string) => ({
      caption: { base_caption: text, char_captions: [] },
      use_coords: false,
      use_order: false,
      legacy_uc: false,
    });
    const sampler = p.sampler || 'k_euler_ancestral';
    return {
      input: positive,
      model: p.model,
      action: 'generate',
      parameters: {
        params_version: 3,
        width,
        height,
        scale: p.cfg,
        sampler,
        steps: p.steps,
        n_samples: 1,
        seed,
        ucPreset: 0,
        qualityToggle: true,
        sm: false,
        sm_dyn: false,
        dynamic_thresholding: false,
        controlnet_strength: 1,
        legacy: false,
        add_original_image: false,
        legacy_v3_extend: false,
        prompt: positive,
        noise_schedule: p.scheduler || 'karras',
        ...(sampler === 'k_euler_ancestral'
          ? { prefer_brownian: true, deliberate_euler_ancestral_bug: false }
          : {}),
        ...(/^nai-diffusion-4(?:-|$)/i.test(p.model)
          ? { v4_prompt: caption(positive), v4_negative_prompt: caption(negative) }
          : { negative_prompt: negative }),
      },
    };
  }
  const values: JsonMap = {
    __PROMPT__: positive,
    __NEGATIVE_PROMPT__: negative,
    __WIDTH__: width,
    __HEIGHT__: height,
    __SEED__: seed,
    __STEPS__: p.steps,
    __CFG__: p.cfg,
    __SAMPLER__: p.sampler || 'euler',
    __SCHEDULER__: p.scheduler || 'normal',
  };
  let workflow: JsonMap;
  try {
    workflow = JSON.parse(规范化ComfyUI工作流JSON(JSON.parse(p.workflow)), (_, v) =>
      typeof v === 'string' && Object.hasOwn(values, v) ? values[v] : v,
    );
  } catch {
    throw new Error('请粘贴有效的 ComfyUI API 工作流 JSON');
  }
  if (!Object.values(workflow).some((n) => obj(n).class_type)) throw new Error('工作流缺少 API 节点');
  return { prompt: workflow, client_id: crypto.randomUUID() };
}
export async function generateImage(c: ImageConfig, positive: string, negative: string, signal: AbortSignal) {
  const p = c.connections[c.backend],
    key = imageVault().get(credentialId(c.backend, p.base));
  if (c.backend === 'novelai' && !key) throw new Error('请填写 NovelAI Token');
  const submit = endpoint(p.base, p.path || paths[c.backend]);
  const response = await send(
    submit,
    signal,
    key,
    buildRequest(c, positive, negative),
    c.backend === 'novelai' ? 'application/zip' : undefined,
  );
  if (c.backend !== 'comfy')
    return readImage(response, signal, c.backend === 'openai' ? { submit, key } : undefined);
  const { prompt_id: id } = json(await bounded(response, 65536));
  if (typeof id !== 'string' || !id) throw new Error('ComfyUI 未返回任务 ID');
  for (;;) {
    const history = json(
      await bounded(await send(endpoint(p.base, 'history/' + encodeURIComponent(id)), signal, key), 1048576),
    );
    const entry = obj(history[id]);
    if (obj(entry.status).status_str === 'error') throw new Error('ComfyUI 工作流执行失败，请检查节点和模型');
    for (const node of Object.values(obj(entry.outputs))) {
      const images = obj(node).images;
      if (!Array.isArray(images)) continue;
      const file = images.find(
        (v) => typeof obj(v).filename === 'string' && (!obj(v).type || obj(v).type === 'output'),
      );
      if (!file) continue;
      const query = new URLSearchParams({
        filename: file.filename,
        subfolder: file.subfolder || '',
        type: 'output',
      });
      return readImage(await send(endpoint(p.base, 'view') + '?' + query, signal, key), signal);
    }
    if (obj(entry.status).completed === true) throw new Error('工作流已完成，但没有输出图片');
    await delay(1000, signal);
  }
}
export async function convertText(c: ImageConfig, system: string, source: string, signal: AbortSignal) {
  if (!c.textModel.trim()) throw new Error('请先配置独立文本模型');
  const key = imageVault().get(credentialId('text', c.textBase));
  const result = json(
    await bounded(
      await send(endpoint(c.textBase, 'chat/completions'), signal, key, {
        model: c.textModel,
        stream: false,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: source },
        ],
      }),
      131072,
    ),
  );
  const message = Array.isArray(result.choices) ? obj(obj(result.choices[0]).message).content : undefined;
  const credentials = [key];
  const imageBase = c.connections[c.backend].base;
  if (imageBase) credentials.push(imageVault().get(credentialId(c.backend, imageBase)));
  if (typeof message === 'string' && credentials.some((secret) => secret && message.includes(secret)))
    throw new Error('响应包含凭证，已丢弃');
  if (typeof message !== 'string') throw new Error('转化器未返回文本');
  const cleaned = 清理生图词组输出(message.replace(/<think>[\s\S]*?<\/think>/gi, '')).slice(0, 8000);
  if (!cleaned) throw new Error('转化器返回空词组');
  return cleaned;
}
export async function probe(c: ImageConfig, signal: AbortSignal) {
  const readPaths: Record<Backend, string> = {
    openai: 'models',
    sd: 'sdapi/v1/options',
    comfy: 'system_stats',
    novelai: 'user/subscription',
  };
  const p = c.connections[c.backend];
  const base =
    c.backend === 'novelai' && new URL(p.base).origin === 'https://image.novelai.net'
      ? 'https://api.novelai.net'
      : p.base;
  const res = await send(
    endpoint(base, readPaths[c.backend]),
    signal,
    imageVault().get(credentialId(c.backend, p.base)),
  );
  json(await bounded(res, 1024 * 1024));
}
