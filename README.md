# 科普编辑部 · Editorial Office

一个把"写科普文章"拆成一间编辑部的 [Claude Code](https://claude.com/claude-code) workflow：策划编辑分角度、记者分头调研、**对抗式事实核查**逐条挑错、作者只用核查通过的事实起草、准确性编辑和外行读者并行审稿、主编润色，最后再过一道终审关。

*A Claude Code workflow that runs a popular science newsroom: plan → research → adversarial fact-check → draft → dual review → polish → final accuracy gate.*

## 编辑部的分工

| 阶段 | 角色 | 做什么 |
|---|---|---|
| Plan | 策划编辑 | 把选题拆成 N 个调研角度（默认 5 个：原理、发现史、前沿争议、与普通人的关系、常见误区），列出外行读者会问的问题 |
| Investigate | 记者 + 核查员（每个角度一对） | 记者联网调研，给出带来源和证据等级（研究设计、样本、是否同行评审）的可核查论断；核查员独立复核每一条，判为 confirmed / corrected / overstated / disputed / unverifiable / false，并检查类比和轶事 |
| Draft | 科普作者 | 只用核查通过的论断写稿；动物实验、观察性研究、预印本必须在句中点明；因果动词只给 RCT / 荟萃分析；每个数字带基线 |
| Review | 准确性编辑 ∥ 目标读者 | 一个对照核查台账挑事实问题，一个以外行身份挑"看不懂、看不下去"的地方 |
| Polish | 主编 | 修掉所有 must-fix，精炼文字，补"参考来源"，写出成稿和台账 |
| Verify | 终审 | 检查标题夸大、限定语被删、凭空出现的事实、来源不在台账里，直接改稿 |

每个角度的调研和核查之间不设屏障：哪个角度先调研完，哪个就先进入核查。

## 使用

需要 Claude Code，并开启 workflow 功能（Pro 用户在 `/config` 里打开 Dynamic workflows）。在本仓库目录下启动 Claude Code，然后：

```
用 popular-science workflow 写一篇科普：为什么我们会做梦？runTag 用 first-try
```

或在 `/workflows` 里直接选择 `popular-science`。参数（`args`）：

| 参数 | 默认 | 说明 |
|---|---|---|
| `topic` | **必填** | 选题 |
| `runTag` | `untagged` | 本次运行的标签；同一选题不带标签的运行会互相覆盖 |
| `slug` | 由 topic 生成 | 输出目录名 |
| `audience` | 没有科学背景的好奇读者 | 目标读者 |
| `length` | 1800–2500 词 / 3000–4500 字 | 篇幅 |
| `lang` | 与选题同语言 | 成稿语言 |
| `angleCount` | `5` | 调研角度数（决定记者+核查员的对数） |
| `angles` | — | 直接给定角度 `[{key, title, focus}]`，跳过策划 |
| `today` | 环境当前日期 | 固定"今天"，便于复现 |
| `articleDir` / `outDir` | `articles` / `research_notes/popular-science/<slug>` | 输出位置 |

产出：

- `articles/<slug>/<版本>-<runTag>.md` — 成稿
- `research_notes/popular-science/<slug>/<版本>-<runTag>/ledger.json` — 事实核查台账（每条论断的判定、更正措辞、共识程度、来源）

一次运行大约要调起 `2 × angleCount + 6` 个子代理，用量会明显高于普通对话。

## 开发

```bash
npm test   # 用桩代理离线跑完整个 workflow，不消耗 token
```

改动 prompt 或流程时请提升 workflow 里的 `VERSION`，并在 `CHANGELOG.md` 记一笔。产出文件名里带版本号，同一选题可以用不同版本、不同 `runTag` 对比效果。

## License

MIT
