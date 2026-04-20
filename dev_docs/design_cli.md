# CLI Design

Status: draft.

## Goal

提供一个可组合的命令行接口，把 `scan`、`export`、`sync` 暴露给用户和 hook。

## Input

- `argv`
- `stdin`

子命令：

```text
git-md-publish scan <repoRoot>
git-md-publish export <repoRoot>
git-md-publish sync remote=<remote> branch=<branch>
git-md-publish publish <repoRoot> remote=<remote> branch=<branch>
```

## Output

各子命令输出规则：

- `scan`：stdout 输出纯文本文件路径列表
- `export`：stdout 输出未压缩 tar
- `sync`：成功或失败通过退出码表达
- `publish`：成功或失败通过退出码表达

统一约定：

- stdout 只承载主结果
- stderr 只承载诊断信息
- 不输出结构化 JSON

## Behavior

- `scan` 不读取 stdin。
- `export` 从 stdin 读取纯文本文件路径列表。
- `sync` 从 stdin 读取 tar。
- `publish` 不读取 stdin。
- CLI 只做参数解析、stdin/stdout 接线、退出码转发。
- 各子命令的业务语义分别遵循对应 design：
  - `scan` -> `design_scan.md`
  - `export` -> `design_export.md`
  - `sync` -> `design_sync.md`
- `publish` 是便捷指令，内部顺序执行 `scan -> export -> sync`。
- `publish` 等价于：

```text
git-md-publish scan <repoRoot> \
| git-md-publish export <repoRoot> \
| git-md-publish sync remote=<remote> branch=<branch>
```

- 标准组合方式是：

```text
git-md-publish scan <repoRoot> \
| git-md-publish export <repoRoot> \
| git-md-publish sync remote=<remote> branch=<branch>
```

## Result Contract

- `scan` 成功时退出码为 `0`，stdout 只包含路径列表。
- `export` 成功时退出码为 `0`，stdout 只包含 tar。
- `sync` 成功时退出码为 `0`。
- `publish` 成功时退出码为 `0`。
- 任一子命令失败时退出码非 `0`。
