import { z } from 'zod';

export const feedbackPath = '/api/feedback';
export const feedbackAdminPath = '/admin/feedback';
export const feedbackBytes = 512 * 1024;
export const feedbackTextLimit = 4_000;
export const feedbackAttachmentLimit = 30_000;
export const feedbackAttachmentTotal = 60_000;
export const feedbackCategories = {
  suggestion: '功能建议',
  problem: '游戏问题',
  experience: '游玩体验',
  other: '其他反馈',
} as const;
export const feedbackStatuses = {
  pending: '待处理',
  reviewing: '处理中',
  fixed: '已修复',
  closed: '已关闭',
} as const;

export const categorySchema = z.enum(Object.keys(feedbackCategories) as (keyof typeof feedbackCategories)[]);
export const statusSchema = z.enum(Object.keys(feedbackStatuses) as (keyof typeof feedbackStatuses)[]);
const stage = z.enum(['story', 'variables', 'world', 'workflow', 'commit']);
const protocol = z.enum(['openai', 'deepseek', 'gemini', 'anthropic']);
const code = z.string().regex(/^[a-zA-Z0-9_]{1,64}$/);
const path = z.string().regex(/^[a-zA-Z0-9_.[\]*-]{1,160}$/);
const index = z.number().int().min(1).max(100_000);
const measured = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const base = {
  version: z.string().regex(/^[a-zA-Z0-9 ._+-]{1,40}$/),
  browser: z.enum(['chrome', 'edge', 'firefox', 'safari', 'other']),
  device: z.enum(['desktop', 'phone', 'tablet', 'other']),
};
const error = z.strictObject({
  ref: index,
  time: z.iso.datetime(),
  stage,
  code,
  model: z.string().min(1).max(200).regex(/^[^\p{Cc}\p{Cf}]+$/u).optional(),
  protocol: protocol.optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  fieldPath: path.optional(),
  commandIndex: index.optional(),
  commandType: code.optional(),
  relatedCommandIndices: z.array(index).max(20).optional(),
  valuePath: path.optional(),
  expectedType: code.optional(),
  actualType: code.optional(),
  validationRule: code.optional(),
  domainRule: code.optional(),
  storyRule: code.optional(),
  storyTag: z.enum(['thinking', '正文', '短期记忆', '变量规划', '行动选项', 'think', 'judge']).optional(),
  storyIssue: code.optional(),
  guideIndex: measured.optional(),
  actualCount: measured.optional(),
  minimumCount: measured.optional(),
  maximumCount: measured.optional(),
  worldRule: code.optional(),
  variableStep: code.optional(),
});
const attachment = z.strictObject({
  errorRef: index,
  content: z.string().min(1).max(feedbackAttachmentLimit).optional(),
  reasoning: z.string().min(1).max(feedbackAttachmentLimit).optional(),
  truncated: z.literal(true).optional(),
}).refine(value => value.content !== undefined || value.reasoning !== undefined);

const suggestion = z.strictObject({
  ...base,
  kind: z.literal('suggestion'),
  category: categorySchema,
  text: z.string().trim().min(1).max(feedbackTextLimit),
});
const report = z.strictObject({
  ...base,
  kind: z.literal('error'),
  text: z.string().max(feedbackTextLimit).optional(),
  errors: z.array(error).min(1).max(50),
  attachments: z.array(attachment).min(1).max(6).optional(),
});

export const feedbackSchema = z.discriminatedUnion('kind', [suggestion, report]).superRefine((value, ctx) => {
  if (value.kind !== 'error') return;
  if (value.errors.some((error, index) => error.ref !== index + 1)) ctx.addIssue({ code: 'custom', message: 'Invalid report references' });
  const refs = new Set<number>();
  let size = 0;
  for (const item of value.attachments ?? []) {
    if (refs.has(item.errorRef) || item.errorRef > value.errors.length) ctx.addIssue({ code: 'custom', message: 'Invalid attachment reference' });
    refs.add(item.errorRef);
    size += (item.content?.length ?? 0) + (item.reasoning?.length ?? 0);
  }
  if (size > feedbackAttachmentTotal) ctx.addIssue({ code: 'custom', message: 'Attachments exceed capacity' });
});
export const submissionIdSchema = z.uuid({ version: 'v4' });
export const feedbackSubmissionSchema = z.strictObject({ submissionId: submissionIdSchema, feedback: feedbackSchema });

export type FeedbackPayload = z.infer<typeof feedbackSchema>;
export type FeedbackReport = Extract<FeedbackPayload, { kind: 'error' }>;
export type FeedbackCategory = z.infer<typeof categorySchema>;
export type FeedbackStatus = z.infer<typeof statusSchema>;
