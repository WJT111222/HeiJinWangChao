# 第三方来源与许可

本阶段从 `WJT111222/MoRanJiangHu@70df74835b969a049c6512a81716eaa0f5591c5a` 的 `prompts/runtime/nsfw.ts`、`prompts/runtime/defaults.ts` 提取部分文本，并参考 `hooks/useGame/promptRuntime.ts`、`mainStoryRequest.ts` 和 `openingStoryWorkflow.ts` 的消息兼容逻辑。未复制请求发送器或武侠判定规则。具体来源、片段/适配差异见 `prompts/sources.lock.json` 和 `M3-P1-DEVELOPMENT.md`。

上游许可证原文如下：

```text
MIT License

Copyright (c) 2026 MikuLXK

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 《我即浪潮 · 1118 peinture》内置适配

- 原作品作者为 ⁺✞ʚ界徐盛重度依赖ɞ✟。
- 输出防截断相关技术来自 S喵 昆仑。
- 酒馆助手与王朝兼容的技术指导由小猫之神提供。

本仓分发已获二传许可的王朝适配正文与两份脚本。许可记录见[首批资源与授权说明](docs/tavernhelper-compat/BATCH1.md#资源与授权)。

## 《我即浪潮 · 1124 anime》内置适配

原作品署名为 ⁺✞ʚ界徐盛重度依赖ɞ✟，防截断相关技术署名为 S喵 昆仑。王朝沿用小猫之神的兼容技术指导署名。项目负责人确认 1124 的改编及随仓分发已获授权。潮汐控制台使用原件内嵌的「浪潮娘 · 港口」图；原作保留其他用途的权利。[原件指纹与逐项对照](docs/tavernhelper-compat/1124/inventory.md)

## 酒馆助手运行库

jQuery 3.7.1 与 Lodash 4.17.23 随内置助手打包。以下为发行包附带的许可与署名。
Copyright OpenJS Foundation and other contributors, https://openjsf.org/

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
Copyright OpenJS Foundation and other contributors <https://openjsf.org/>

Based on Underscore.js, copyright Jeremy Ashkenas,
DocumentCloud and Investigative Reporters & Editors <http://underscorejs.org/>

This software consists of voluntary contributions made by many
individuals. For exact contribution history, see the revision history
available at https://github.com/lodash/lodash

The following license applies to all parts of this software except as
documented below:

====

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

====

Copyright and related rights for sample code are waived via CC0. Sample
code is defined as all source code displayed within the prose of the
documentation.

CC0: http://creativecommons.org/publicdomain/zero/1.0/

====

Files located in the node_modules and vendor directories are externally
maintained libraries used by this software which have their own
licenses; we recommend you read them, as their terms may differ from the
terms above.

## SPreset 本地运行时实验（C2）

SPreset 发行源码来自 SoliUmbra / starowo 的 `starowo/starowo.github.io` 仓库。
C2 在 `experiments/spreset/` 提供修改后的可编辑组件、完整 GPL 第三版许可及对应源码清单。
小猫之神的 Meowssiah 预设按作者提供的适配许可研究，其署名和原包指纹见清单。
本地开发实验的入口、分发边界及验证记录见
[SPreset 运行时原型](docs/tavernhelper-compat/SPRESET_C2.md)。
