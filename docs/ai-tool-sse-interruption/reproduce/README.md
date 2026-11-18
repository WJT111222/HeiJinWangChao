# 隔离复现

从仓库根目录、在 PR #191 的调查基线或本报告提交上以 Node 24 运行。需要锁文件安装的真实 Vitest 和 fake-indexeddb。夹具不注册到仓库默认测试集，也不使用真实网络或凭证。

```bash
node --version
npm --version
npm ci
mkdir -p .pr191-sse-mock
cp docs/ai-tool-sse-interruption/reproduce/sse-interruption.test.ts.txt .pr191-sse-mock/sse-interruption.test.ts
cp docs/ai-tool-sse-interruption/reproduce/vitest.config.mjs.txt .pr191-sse-mock/vitest.config.mjs
npx --no-install vitest run --config .pr191-sse-mock/vitest.config.mjs --reporter verbose
npx --no-install vitest run src/tests/story-tool-trace.test.ts src/tests/story-tool-events.test.ts src/tests/story-tool-runtime.test.ts src/tests/response-events.test.ts src/tests/ai-client.test.ts
```

`.pr191-sse-mock/MOCK_RESULTS.json` 仅保存预设分支和脱敏观测结果。报告中的日志使用 `EXPECTED_EVIDENCE_PATH` 把结果输出到隔离证据目录。请求指纹仅在测试内作相等比较，未写入文件。
