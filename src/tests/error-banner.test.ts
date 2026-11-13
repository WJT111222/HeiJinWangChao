import { describe, expect, it } from 'vitest';
import { errorBannerKey } from '../ui/game/errorBanner';

// 错误横幅关闭作用域：同一错误在普通重渲染下键不变；跨回合、换正文版本或新的失败事件都会得到新键（横幅重新出现）。
const scope = { saveId: 'save-a', turnId: 'turn-a', storyRevision: 1, failureSeq: 1 };
const messages = ['变量管理：候选字段或类型不符合命令Schema，候选未保存。'];
const failures = [{ stage: 'variables', errorCode: 'schema_fields', attempt: 1 }];

describe('错误横幅关闭作用域', () => {
  it('① 同一回合同一错误：重复计算（重渲染）得到同一个键，关闭后保持隐藏', () => {
    expect(errorBannerKey({ ...scope }, [...messages], failures.map(f => ({ ...f })))).toBe(errorBannerKey(scope, messages, failures));
  });
  it('② 跨回合出现文案、错误码、尝试次数都相同的错误，键不同，横幅重新出现', () => {
    expect(errorBannerKey({ ...scope, turnId: 'turn-b' }, messages, failures)).not.toBe(errorBannerKey(scope, messages, failures));
  });
  it('② 换存档时同样的错误也重新出现', () => {
    expect(errorBannerKey({ ...scope, saveId: 'save-b' }, messages, failures)).not.toBe(errorBannerKey(scope, messages, failures));
  });
  it('③ 同一回合又失败了一次（失败事件序号增加），即使文案相同也重新出现', () => {
    expect(errorBannerKey({ ...scope, failureSeq: 2 }, messages, failures)).not.toBe(errorBannerKey(scope, messages, failures));
  });
  it('③ 重写正文后的同类失败也重新出现', () => {
    expect(errorBannerKey({ ...scope, storyRevision: 2 }, messages, failures)).not.toBe(errorBannerKey(scope, messages, failures));
  });
  it('键里只有安全标识与已显示的文案摘要，不含任何额外字段', () => {
    const key = JSON.parse(errorBannerKey(scope, messages, failures)) as unknown[];
    expect(key).toEqual(['save-a', 'turn-a', 1, 1, messages, [['variables', 'schema_fields', 1]]]);
  });
});
