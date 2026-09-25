# 版面解析 ONNX 模型（不入库）

运行 `npm run model:download` 从 ModelScope 下载 PP-DocLayoutV2（Apache-2.0，约 204 MB）。
脚本会先检查已有文件，并在下载完成后验证 SHA-256；也可以单独运行 `npm run model:verify`。

```text
0bd2ea0997fe0789f0300292291f8bbf897d890b44a9a3bd5be72afd6198aa90  pp_doc_layoutv2.onnx
```

没有模型时应用会退回启发式解析，基础阅读仍可用，但版面识别精度会降低。
