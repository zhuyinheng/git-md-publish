# Export Design

Status: draft.

## Goal

给定一个 `git repo` 和一个文件路径列表，导出一个 tar。

## Input

- `repoRoot`

标准输入是纯文本文件路径列表。

格式约定：

```text
notes/a.md
notes/b.md
assets/diagram.png
```

- 每行一个路径
- 路径是 repo-relative
- 使用 `/` 作为分隔符
- 输出顺序不依赖输入顺序，最终 tar entry 顺序必须稳定

## Output

标准输出是一个未压缩 tar。

## Behavior

- 导出对象是 `repoRoot` 当前 `HEAD` 的已提交树。
- 读取 stdin 中的路径列表。
- 空行忽略。
- 重复路径去重。
- 利用 `git archive + 文件路径列表` 导出 tar。
- tar 只包含路径列表中列出的文件。
- 文件类型、mode、blob 内容由 git archive 按 `HEAD` 自动处理。
- tar entry 顺序必须稳定。
- 协议不引入压缩。

## Result Contract

- 成功时，stdout 只包含 tar。
- tar 内文件集合必须与输入路径列表一致。
- 若路径列表中的某个路径不在 `HEAD` 中，导出失败。
