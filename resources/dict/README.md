# 内置离线词典

`ecdict.sqlite` 是应用内置的英汉词典,双击原文单词时零延迟、零成本地给出释义
(词典未命中才回退 LLM)。

## 来源与授权

数据来自 [skywind3000/ECDICT](https://github.com/skywind3000/ECDICT),MIT License,
授权原文见同目录 `LICENSE.ECDICT`。

## 如何重建

上游发布的是全量 `stardict.db`(约 800MB,含词频、词形、例句等数十列)。本仓库
只收录按词频裁剪后的三列精简库(word / phonetic / translation,约 17 万词条 16MB):

```bash
# 1. 从 ECDICT Releases 下载 ecdict-sqlite-28.zip 并解压出 stardict.db
# 2. 重建精简库
npm run dict:build -- /path/to/stardict.db
```

裁剪口径:BNC 或当代语料词频前 12 万,并入所有带柯林斯/牛津标记的词条。
