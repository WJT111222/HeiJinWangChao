# 本轮真实命令与复现

Node v24.19.0；PR目录 `/workspace/pr153-catalog`，干净main目录 `/workspace/pr153-main-baseline`。配置仅隔离端口/报告位置，保持原有项目、workers=2、retries=0。

```bash
node --version
npm ci --cache /workspace/creation-fullscreen-evidence/npm-cache --no-audit --no-fund
npm run check
npm run prompts:check
git diff --check origin/main
npm run catalog:refresh
npm run catalog:check

npx vitest run src/tests/catalog-compaction.test.ts src/tests/catalog-wire-acceptance.test.ts \
 src/tests/world-*.test.ts src/tests/npc-final-runtime.test.ts src/tests/npc-unified-memory.test.ts \
 src/tests/event-stages-v2.test.ts src/tests/prompt-runtime.test.ts \
 src/tests/format-tail-wire.test.ts src/tests/context-budget.test.ts

PR153_WIRE_EVIDENCE=/workspace/pr153-evidence/pr-wire.json \
 npx vitest run src/tests/catalog-wire-acceptance.test.ts src/tests/catalog-compaction.test.ts
# main仅增加同一验收探针，无生产改动，运行后移除探针：
PR153_WIRE_EVIDENCE=/workspace/pr153-evidence/main-wire.json \
 npx vitest run src/tests/pr153-wire-acceptance.test.ts

CHROMIUM_PATH=/usr/bin/chromium npx playwright test \
 e2e/world-npc-creation.spec.ts e2e/world-runtime.spec.ts e2e/continuous-turns.spec.ts \
 e2e/event-stages-v2.spec.ts e2e/history-timeline-v2.spec.ts e2e/format-tail-wire.spec.ts \
 e2e/npc-final-acceptance.spec.ts --config /workspace/pr153-evidence/pr-browser.config.ts
# main只跑相应23个手机场景：
CHROMIUM_PATH=/usr/bin/chromium npx playwright test \
 e2e/continuous-turns.spec.ts e2e/event-stages-v2.spec.ts e2e/history-timeline-v2.spec.ts \
 e2e/npc-final-acceptance.spec.ts e2e/world-npc-creation.spec.ts e2e/world-runtime.spec.ts \
 --project mobile --config /workspace/pr153-evidence/main-browser.config.ts
# 预计算后23个旧桌面场景和两个新UI：
CHROMIUM_PATH=/usr/bin/chromium npx playwright test \
 e2e/catalog-wire-ui.spec.ts e2e/world-npc-creation.spec.ts e2e/continuous-turns.spec.ts \
 e2e/event-stages-v2.spec.ts e2e/history-timeline-v2.spec.ts e2e/npc-final-acceptance.spec.ts \
 e2e/world-runtime.spec.ts --project desktop --config /workspace/pr153-evidence/pr-after.config.ts
# 最终修正夹具后的双端四场景：
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/catalog-wire-ui.spec.ts \
 --config /workspace/pr153-evidence/pr-wire-ui.config.ts
# 最终已有6个手机成功场景的精确grep参数留在 logs/final-mobile-command.json.gz
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/format-tail-wire.spec.ts \
 --project desktop --config /workspace/pr153-evidence/pr-tail-after.config.ts

# 性能最终顺序执行，避免同任务工程/功能测试同时争用CPU：
PR153_TARGET=pr CHROMIUM_PATH=/usr/bin/chromium npx playwright test \
 --config /workspace/pr153-evidence/pr-perf.config.ts
PR153_TARGET=main CHROMIUM_PATH=/usr/bin/chromium npx playwright test \
 --config /workspace/pr153-evidence/main-perf.config.ts
```

所有配置和性能脚本原样保存为 configs/*.txt；重现时恢复 `.ts` 后按实际工作区替换绝对路径。此处的npm缓存是正式包缓存，不是离线垫片或替代运行器。性能脚本使用仓库真实Playwright和本机真实Chromium。
