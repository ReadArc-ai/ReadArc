# 参与 ReadArc

## 开发环境

要求 Node.js ≥ 22.19.0、macOS（Apple Silicon 为主要目标平台）。

```bash
npm install
npm run model:download   # 版面解析模型（~204MB）；不下载则自动退回启发式解析
npm run dev
```

提交前三件事必须全绿：

```bash
npm run typecheck        # tsc（web + node 两套 tsconfig）
npm run lint             # eslint src electron shared
npm test                 # vitest
```

## 产品原则（代码注释里的 `[P1]`–`[P7]`）

源码注释常用 `[Pn]` 标注某段代码在守哪条产品底线。改动这些位置前请先确认没有破坏对应原则。

| | 原则 | 含义 |
|---|---|---|
| P1 | 开机即读 | 冷启动到上次阅读位置可见 ≤ 1.5s，无引导、无登录、无更新弹窗打断 |
| P2 | 一键回到阅读 | 任何界面回到「继续读」≤ 1 次点击；`⌘1` 永远是阅读器 |
| P3 | 正文永不被遮挡 | 文档列 `min-width 400px`；先收侧栏再收面板；不足则面板默认关闭的浮层 |
| P4 | AI 失败不阻塞阅读 | 原文仍完整可读；就地提示 + 重试/换本地模型；不弹模态框、不清空已有译文 |
| P5 | 三步可读第一篇 | 选来源 → 填密钥或指向本地模型 → 开始 |
| P6 | 痕迹永不丢失 | 笔记落盘 Markdown；文件改名/移动/解析器升级后锚点仍可定位 |
| P7 | 花钱前先问 | 单次预估 > $0.5 先确认；用量可见；不替用户设限，实际以供应商账单为准 |

## 常见改动的落点

- **加一个模型供应商**：`electron/model/profiles.ts` 加一个对象（slug / base_url / key_env / 官网），再在 `src/assets/logos/` 放一个 logo
- **加一个论文检索源**：`electron/search/sources/` 下新增一个文件，实现 `electron/search/types.ts` 里的源接口
- **改版面解析**：`electron/docengine/`。`layout-ml.ts` 是 ONNX 路径，`layout.ts` 是无模型时的启发式路径，两条路都要能跑
- **加一个 IPC**：`shared/ipc.ts` 加常量与桥类型，`electron/preload.ts` 加桥方法，处理器放 `electron/ipc/` 里对应功能的文件（library / translate / chat / search / notes / models / data / settings），`main.ts` 只管窗口、菜单和生命周期
- **改设置页**：`src/app/settings/` 一个页签一个文件（GeneralTab / PersonasTab / MainModelTab / ModelsTab / NetworkTab / DataTab），公用的分区与行式布局在 `shared.tsx`
- **改阅读器**：原版页在 `src/app/reader/PdfPage.tsx`，镜像译文页在 `TranslatedPage.tsx`，句子边界与引用链接等纯文本处理在 `page-text.tsx`；右侧面板拆成 `ChatTab.tsx` / `NotesTab.tsx` / `ChatPickers.tsx`
- **改样式**：`src/assets/styles/` 按模块分文件，`app.css` 里的引入顺序就是层叠顺序。新样式写进对应模块；`patches.css` 只放必须压过多个模块的后期调整，`controls.css` 固定最后
- **改配置读写**：`electron/config/`。配置文件属于用户——一律走 `yaml-patch.ts` 的原地拼接，不要「解析成对象再整体写回」（那会吃掉用户的注释与未知字段）

## 约定

- 注释写中文，说明**为什么**这么写（尤其是绕开某个坑的地方），而不是复述代码在做什么
- 密钥只出现在 `~/.readarc/.env`，永不进配置文件、永不进日志、永不进仓库
- 有几何/解析类的修复，请把触发它的真实版面固化成 `*.test.ts` 里的回归用例
