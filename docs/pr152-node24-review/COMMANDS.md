# 最终定向单测命令

实际执行于 `/workspace/pr152-v10`，Node v24.19.0，516 通过/21 文件。

```bash
npx vitest run \
  src/tests/variable-source-port.test.ts \
  src/tests/text-protocol-readiness.test.ts \
  src/tests/text-prompt-readiness.test.ts \
  src/tests/variables-contract-stability.test.ts \
  src/tests/variable-source-runtime.test.ts \
  src/tests/prompt-runtime.test.ts \
  src/tests/format-tail.test.ts \
  src/tests/saveRepository.test.ts \
  src/tests/save-backup.test.ts \
  src/tests/unreadable-saves.test.ts \
  src/tests/world-handoff.test.ts \
  src/tests/event-stages-v2.test.ts \
  src/tests/npc-v2-foundation.test.ts \
  src/tests/npc-unified-memory.test.ts \
  src/tests/npc-final-runtime.test.ts \
  src/tests/npc-final-volume.test.ts \
  src/tests/npc-importance.test.ts \
  src/tests/npc-roster.test.ts \
  src/tests/variable-commands.test.ts \
  src/tests/live-text-turn.test.ts \
  src/tests/v10-prompt-load.test.ts
```

完整检查与浏览器命令见 REPORT.md；无需运行全量 E2E。
