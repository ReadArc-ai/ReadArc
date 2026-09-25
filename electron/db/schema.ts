/**
 * SQLite schema。论文解析产物可重建；对话历史也保存在这里，笔记与高亮则在 Markdown 文件里 [P6]。
 * 迁移用 PRAGMA user_version 顺序执行。
 */

export const MIGRATIONS: string[] = [
  // v1 — 初始 schema
  `
  CREATE TABLE papers (
    id             TEXT PRIMARY KEY,          -- sha1(文件内容)
    file_path      TEXT NOT NULL,
    title          TEXT,
    title_zh       TEXT,
    authors        TEXT,                      -- JSON 数组
    year           INTEGER,
    source         TEXT,                      -- arXiv / NeurIPS / …
    arxiv_id       TEXT,
    doi            TEXT,
    status         TEXT NOT NULL DEFAULT 'new',   -- new | reading | done
    progress       REAL NOT NULL DEFAULT 0,       -- 按最深滚动位置 0–100，只增不减
    last_section   TEXT,                          -- 停在哪一节（§3 Method）
    scroll_position REAL NOT NULL DEFAULT 0,      -- 恢复用的当前位置
    added_at       INTEGER NOT NULL,
    last_opened_at INTEGER
  );

  CREATE TABLE blocks (
    block_id    TEXT PRIMARY KEY,             -- sha1(file):page:order（见 docengine/anchor.ts）
    paper_id    TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    page        INTEGER NOT NULL,
    block_order INTEGER NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'para', -- para | heading | figure | table | equation
    section     TEXT,
    text        TEXT NOT NULL,
    bbox        TEXT,                         -- JSON [x, y, w, h]
    simhash     TEXT NOT NULL,                -- 64 位十六进制
    heading_level INTEGER                     -- 仅 heading 块：1/2/3，目录树从这里重建
  );
  CREATE INDEX idx_blocks_paper ON blocks(paper_id, page, block_order);

  -- 译文永久缓存：键含 glossary_version 与 prompt_version，改术语表自然失效重译
  CREATE TABLE translations (
    block_id         TEXT NOT NULL,
    glossary_version INTEGER NOT NULL,
    prompt_version   INTEGER NOT NULL,
    model            TEXT NOT NULL,
    text             TEXT NOT NULL,
    created_at       INTEGER NOT NULL,
    PRIMARY KEY (block_id, glossary_version, prompt_version)
  );

  CREATE VIRTUAL TABLE blocks_fts USING fts5(text, content='blocks', content_rowid='rowid');
  CREATE TRIGGER blocks_ai AFTER INSERT ON blocks BEGIN
    INSERT INTO blocks_fts(rowid, text) VALUES (new.rowid, new.text);
  END;
  CREATE TRIGGER blocks_ad AFTER DELETE ON blocks BEGIN
    INSERT INTO blocks_fts(blocks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  END;
  CREATE TRIGGER blocks_au AFTER UPDATE OF text ON blocks BEGIN
    INSERT INTO blocks_fts(blocks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
    INSERT INTO blocks_fts(rowid, text) VALUES (new.rowid, new.text);
  END;

  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
  `,
  // v2 — 用量计量（[P7] 用量可见的地基；成本换算在展示层做）
  `
  CREATE TABLE usage_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ts            INTEGER NOT NULL,
    task          TEXT NOT NULL,
    provider      TEXT NOT NULL,
    model         TEXT NOT NULL,
    input_tokens  INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL
  );
  CREATE INDEX idx_usage_ts ON usage_log(ts);
  `,
  // v3 — AI 三句话摘要缓存（打开时按需生成一次并缓存）
  `
  CREATE TABLE summaries (
    paper_id       TEXT NOT NULL,
    prompt_version INTEGER NOT NULL,
    model          TEXT NOT NULL,
    text           TEXT NOT NULL,
    created_at     INTEGER NOT NULL,
    PRIMARY KEY (paper_id, prompt_version)
  );
  `,
  // v4 — 检索结果缓存 24h（限流打在用户 IP 上，能省则省）
  `
  CREATE TABLE search_cache (
    query_norm TEXT NOT NULL,
    source     TEXT NOT NULL,
    json       TEXT NOT NULL,
    ts         INTEGER NOT NULL,
    PRIMARY KEY (query_norm, source)
  );
  `,
  // v5 — 块的原始字号（PDF pt）：镜像译文页按原字号层级排版；旧数据 NULL 走启发式
  `
  ALTER TABLE blocks ADD COLUMN font_size REAL;
  `,
  // v6 — 页边块（页眉页脚 / 侧边水印）是否已补：老论文首次打开时从 PDF 文本层补一次
  `
  ALTER TABLE papers ADD COLUMN margins_ready INTEGER NOT NULL DEFAULT 0;
  `,
  // v7 — AI 对话历史：每篇论文可有多次独立会话，删除论文时级联清理
  `
  CREATE TABLE chat_sessions (
    id         TEXT PRIMARY KEY,
    paper_id   TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    title      TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_chat_sessions_paper_updated
    ON chat_sessions(paper_id, updated_at DESC);

  CREATE TABLE chat_messages (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id     TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role           TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    text           TEXT NOT NULL,
    persona        TEXT,
    citations_json TEXT,
    model          TEXT,
    cost_usd       REAL,
    tokens         INTEGER,
    hops_json      TEXT,
    stopped        INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL
  );
  CREATE INDEX idx_chat_messages_session
    ON chat_messages(session_id, id);
  `,
  // v8 — 截图提问附的图（PNG data URL）与推理模型的思考流随历史落库，重启后还能看到
  `
  ALTER TABLE chat_messages ADD COLUMN image TEXT;
  ALTER TABLE chat_messages ADD COLUMN thinking TEXT;
  `,
  // 版面识别状态：导入先用启发式分段开页（pending），模型识别在后台替换后置 done；旧数据视为 done
  `
  ALTER TABLE papers ADD COLUMN layout_state TEXT NOT NULL DEFAULT 'done';
  `,
  // 行内公式截图记录（JSON InlineFormula[]）：正文里的 ⟦fN⟧ 占位符各对应一张原版截图；旧数据 NULL
  `
  ALTER TABLE blocks ADD COLUMN inlines TEXT;
  `,
  // 文字表（提示词、推理轨迹）改为逐格翻译、目录页不再误判成图：含表格或图块的旧论文重新做一次
  // 版面识别（后台排队，译文按内容指纹搬家、笔记按原文重定位），之前截图显示的整页文字这样才有译文
  `
  UPDATE papers SET layout_state = 'pending' WHERE id IN (SELECT DISTINCT paper_id FROM blocks WHERE kind IN ('table', 'figure'));
  `,
  // 版面解析版本：解析规则改了（LAYOUT_VERSION 加一），启动时把用旧版识别的论文排进后台重新识别，
  // 不必每次手写迁移。旧数据为 0，下次启动按当前规则重识别一次
  `
  ALTER TABLE papers ADD COLUMN layout_version INTEGER NOT NULL DEFAULT 0;
  `,
]
