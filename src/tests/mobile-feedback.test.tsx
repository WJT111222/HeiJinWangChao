import {test,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {Feedback} from '../ui/Feedback';
import {VariableCandidates} from '../ui/game/VariableCandidates';
import {WorldCandidates} from '../ui/game/WorldCandidates';
import {OutputTokenLimit} from '../ui/settings/OutputTokenLimit';
import {ThemedSelect} from '../ui/components/ThemedSelect';
import {worldResult,worldDraft} from './fixtures/world';

test.each(['err','warn','info','ok']as const)('手机 %s 提示保留完整文案、role 与操作',level=>{const html=renderToStaticMarkup(<Feedback level={level} role="status" mobileAs="p" actions={<button disabled>原操作</button>}>原始错误码 variables_schema；完整说明与费用提醒。</Feedback>);expect(html).toContain('role="status"');expect(html).toContain('原始错误码 variables_schema；完整说明与费用提醒。');expect(html).toContain(`l-${level}`);expect(html).toContain('disabled');});
test('关闭的候选不渲染内部 JSON、原始响应或改变输入',()=>{const draft=worldDraft();draft.world={storyRevision:draft.storyRevision,candidateRevision:1,requestRevision:0,basedOnVariableRevision:1,validation:'validated',result:worldResult()};const before=structuredClone(draft);const html=renderToStaticMarkup(<><VariableCandidates draft={draft}/><WorldCandidates draft={draft}/></>);expect(html).toContain('查看变量候选（未结算）');expect(html).toContain('查看世界候选（未结算）');expect(html).not.toContain('<pre');expect(html).not.toContain('SetWorldClock');expect(draft).toEqual(before);});
test.each([undefined,1,12345,1000000])('自定义 Token %s 保留范围、值与 numeric 输入',value=>{const html=renderToStaticMarkup(<OutputTokenLimit value={value} onChange={()=>undefined}/>);expect(html).toContain('自定义最大输出 Token');expect(html).toContain('min="1"');expect(html).toContain('max="1000000"');expect(html).toContain('inputMode="numeric"');expect(html).toContain(`value="${value??''}"`);});
test('禁用选择器保持语义，不渲染可操作浮层或虚构选择',()=>{const html=renderToStaticMarkup(<ThemedSelect label="正式字段" value="unknown" options={[{value:'known',label:'已知值'}]} disabled onChange={()=>undefined}/>);expect(html).toContain('aria-expanded="false"');expect(html).toContain('disabled');expect(html).toContain('unknown');expect(html).not.toContain('role="listbox"');});

test("空反馈不产生卡片、装饰或额外操作",()=>{const html=renderToStaticMarkup(<Feedback className="notice" mobileAs="p">{''}</Feedback>);expect(html).toBe('<p class="notice"></p>');});
