export const announcementFile: string;
export const announcementBinding: string;
export const announcementUrl: string;
export const scriptPath: string;
export const repoRoot: string;
export function stripJsonc(text: string): string;
export function announcementNamespace(jsoncText: string, binding?: string): string;
export function publishDecision(input: { ref: string; current: string; latest: string | undefined }):
  { publish: boolean; fail: boolean; reason: string };
export function checkOnline(input: {
  version: string; url?: string; fetcher?: typeof fetch; attempts?: number; wait?: number; timeout?: number;
}): Promise<{ ok: boolean; source: string; version: string }>;
