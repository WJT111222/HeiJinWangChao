import re, json, hashlib, pathlib
import argparse

parser = argparse.ArgumentParser(
    description="根据固定 Meowssiah 原件重建文学资源与逐项清单"
)
parser.add_argument("original", type=pathlib.Path)
raw = parser.parse_args().original.read_bytes()
if (
    hashlib.sha256(raw).hexdigest()
    != "81c74429031e005fec1d0ea0a2cb7b4c35e3a055c3ce2ad4a7f3cf9c2fdf57f0"
):
    raise SystemExit("原件 SHA-256 不匹配")
d = json.loads(raw)
s = d["extensions"]["SPreset"]
order = d["prompt_order"][1]["order"]
rows = {r["identifier"]: r["enabled"] for r in order}
slots = "worldInfoBefore personaDescription charDescription charPersonality scenario worldInfoAfter dialogueExamples chatHistory".split()
prompts = []
menu = []
audit = []
for p in d["prompts"]:
    i = p["identifier"]
    n = p["name"]
    raw = p.get("content", "")
    t = raw
    reason = "停用 · 酒馆控制标记、合成对话或重复协议"
    keep = False
    m = re.match(r"^<<<\|catgodml\|(menu|radio):([^:]+):(.+?)>>>\s*", raw)
    if i in slots:
        keep = True
        t = ""
        reason = "王朝材料槽或正式历史"
    elif n == "用户角色":
        keep = True
        t = "|用户：{{user}}|"
        reason = "保留真实玩家名字宏；移除编辑说明"
    elif i == "main":
        reason = "署名与原声明移至许可文件"
    elif i == "version_info":
        reason = "版本清单"
    elif i == "SPresetSettings":
        reason = "内联处理器镜像，仅校对"
    elif i == "enhanceDefinitions":
        reason = "停用原对话；单独标识 SoliUmbra 文学创作者，游戏规则继续生效"
    elif i == "catgod-macro-tutorial-doc":
        reason = "作者教程，不发送"
    elif i == "catgod-deepthink-steps-base":
        reason = "停用 · 原包的显式思考模拟"
    elif m and n == "📏猫猫留言~":
        keep = True
        t = "你可以在 soliumbra_reply 的可选 comment 字段里放点想对玩家说的话，或分享对剧情的想法。"
        reason = "保留可选作者留言；独立 comment 字段在模型原文中以纯文本阅读"
        menu.append(
            dict(id=i, kind=m[1], group="猫猫留言", label="📏猫猫悄悄话", name=n)
        )
    elif m and m[2] != "输出格式模块":
        keep = True
        t = t[m.end() :]
        reason = "原版文学条目，菜单指令由宿主读取"
        if i == "eb65ec28-14a7-401c-887a-e6e22c3295c9":
            t = "在剧情发生处穿插角色的内心活动，以独立的纯文本段落呈现，例如「林舟心想：……」。遵守当前视角和人物知情边界。"
            reason = "保留原位角色内心话，以阅读器支持的纯文本段落呈现"
        menu.append(dict(id=i, kind=m[1], group=m[2], label=m[3], name=n))
    elif n == "⚙️防全知（带思维链）":
        t = t.split("<<<")[0].strip()
        keep = True
        reason = "保留认知边界，移除注册思考步骤"
    elif n.startswith("----"):
        reason = "归入控制台分组，省略模拟角色对话"
    elif n.startswith("📏") or "留言" in n:
        reason = "复用王朝标签、行动选项及记忆；不创建额外业务字段"
    if keep:
        t = re.sub(r"\{\{//.*?\}\}", "", t, flags=re.S).strip()
        prompts.append(
            {
                k: v
                for k, v in p.items()
                if k
                in (
                    "identifier",
                    "role",
                    "marker",
                    "injection_depth",
                    "injection_order",
                    "injection_position",
                    "name",
                )
            }
            | {"content": t}
        )
    audit.append(
        [
            i,
            n,
            str(rows.get(i, "未排入 100001")),
            reason,
            hashlib.sha256(raw.encode()).hexdigest()[:16],
        ]
    )
prompts.append(
    {
        "identifier": "catgod-author",
        "role": "system",
        "content": "小猫之神 SoliUmbra · 神域剧场。依照以下启用的文学条目写作；人物、玩家行动与本回合输出格式以游戏资料为依据。",
    }
)
idx = {p["identifier"] for p in prompts}
menu.sort(
    key=lambda item: next(
        i for i, row in enumerate(order) if row["identifier"] == item["id"]
    )
)
reg = d["extensions"]["regex_scripts"]
assert reg == s["RegexBinding"]["regexes"], "两份正则绑定已分叉，需重新审查"
# Two history rules operate solely on the derived assistant messages. The third summary rule belongs to the ST summary-only history.
rules = [reg[i] for i in (0, 5)]
prompts.append({"identifier": "catgod-direction", "role": "user", "content": ""})
res = {
    k: d[k] for k in ("temperature", "top_p", "presence_penalty", "frequency_penalty")
} | {
    "prompts": prompts,
    "prompt_order": [
        {
            "character_id": 100001,
            "order": [{"identifier": "catgod-author", "enabled": True}]
            + [r for r in order if r["identifier"] in idx]
            + [{"identifier": "catgod-direction", "enabled": True}],
        }
    ],
    "extensions": {"regex_scripts": rules},
}


def write(p, v):
    pathlib.Path(p).write_text(json.dumps(v, ensure_ascii=False, indent=2) + "\n")


write("src/presets/meowssiah/literature.json", res)
write("src/presets/meowssiah/menu.json", menu)
pathlib.Path("docs/tavernhelper-compat/meowssiah/AUTHOR.txt").write_text(
    "\n".join(
        line.rstrip()
        for line in next(
            p["content"] for p in d["prompts"] if p["identifier"] == "main"
        ).splitlines()
    )
    + "\n"
)
doc = [
    "# 原件逐项审计",
    "",
    "Meowssiah-2.1.7.json · SHA-256 81c74429031e005fec1d0ea0a2cb7b4c35e3a055c3ce2ad4a7f3cf9c2fdf57f0。100001 表含 54 条；原件其余两条未排入该顺序表。下列摘要按 UTF-8 原文计算。",
    "",
    "| 标识 | 名称 | 出厂启用 | 处理 | SHA-256 前 16 位 |",
    "|---|---|---|---|---|",
]
for row in audit:
    doc += ["| " + " | ".join(x.replace("|", "／") for x in row) + " |"]
doc += [
    "",
    "## 正则及两份绑定清单",
    "",
    "| 名称 | 主表 ID | SPreset 绑定 ID | 用途 |",
    "|---|---|---|---|",
]
for i, (r, b) in enumerate(zip(reg, s["RegexBinding"]["regexes"], strict=True)):
    doc += [
        "| "
        + " | ".join(
            [
                r["scriptName"],
                r["id"],
                b["id"],
                (
                    "历史消息副本过滤，仅运行一次"
                    if i in (0, 5)
                    else (
                        "王朝已有正式记忆，不执行酒馆小总结替换"
                        if i == 7
                        else "展示用 HTML 由安全的原文／正文界面替代"
                    )
                ),
            ]
        )
        + " |"
    ]
pathlib.Path("docs/tavernhelper-compat/meowssiah/inventory.md").write_text(
    "\n".join(doc) + "\n"
)

# Hash the shipped edition, including static regexes and local processing semantics.
root = pathlib.Path("experiments/meowssiah")
source_list = root / "SOURCES.json"
manifest = json.loads(source_list.read_text())
manifest["localFiles"] = {
    filename: hashlib.sha256((root / filename).read_bytes()).hexdigest()
    for filename in manifest["localFiles"]
}
write(source_list, manifest)
edition = hashlib.sha256("".join(manifest["localFiles"].values()).encode()).hexdigest()
definition = pathlib.Path("src/presets/meowssiah/definition.ts")
definition.write_text(
    re.sub(
        r"3\.0-Preview-01\.301-[a-f0-9]{64}",
        "3.0-Preview-01.301-" + edition,
        definition.read_text(), count=1,
    )
)
