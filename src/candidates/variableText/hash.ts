import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { fingerprint } from '../../domain/commands';
// 同步计算只作一致性绑定；不以候选自带摘要代替来源授权。
export const sealValue = (value: unknown): string => bytesToHex(sha256(new TextEncoder().encode(fingerprint(value))));
