# Sync Design

Status: draft.

## Goal

给定一个 tar，把 tar 中的内容同步到一个目标位置。

## Input

- 标准输入是一个 tar
- `remote`
- `branch`

`remote` 支持两种形式：

- GitHub remote repo
- 本地 folder 路径

GitHub remote repo 形式：

```text
remote=git@github.com:user/repo.git
branch=main
```

本地 folder 形式：

```text
remote=/path/to/target
branch=main
```

本地 folder 约束：

- folder 可以不存在
- folder 若已存在，可以为空目录
- folder 若已存在且为 bare repo，可以被复用
- 复用条件是 repo-local state 匹配
- 其他情况 sync 失败

tar 约束：

- tar 来自 `git archive <commit-ish>`
- 不接受 `git archive <tree>` 产生的 tar

## Output

成功或失败通过进程退出码表达。

- exit code `0`：同步成功
- non-zero：同步失败

成功时不要求结构化 stdout。

## Behavior

- 使用纯 JS tar reader 读取 tar。
- 将 tar 内容解压到 in-memory fs。
- 在 in-memory repo 中执行 `git init`。
- 执行 `git add -A`。
- 创建单个 snapshot commit。
- commit 使用 host 当前可用的 git identity。
- 若 host 未配置 `user.name` 或 `user.email`，commit 失败是正常行为。
- `sourceCommit` 从 tar 的 global extended pax header 读取。
- 读取方式等价于 `git get-tar-commit-id`。
- `mtime` 从 tar entry header 读取。
- 所有 payload entry 的 `mtime` 必须一致。
- 这个一致的 `mtime` 作为本次 sync 的 canonical mtime。
- commit message 必须包含 `sourceCommit` 和 `mtime`。
- 建议模板：

```text
snapshot: src=<sourceCommit> mtime=<mtime>
```

- `git commit --date` 使用同一个 `mtime`。
- 使用内部 repo 的当前 `HEAD`。
- 在内部 repo 中配置 remote。
- 将当前 `HEAD` push 到目标 branch。
- push 方式采用 `--force`。
- 当 `remote` 是本地 folder 路径时：
  - 若路径不存在，先创建目录并执行 `git init --bare`
  - 若路径存在且为空，直接执行 `git init --bare`
  - 若路径存在且为 bare repo，检查 repo-local state
  - 若 state 匹配，复用该 bare repo
  - 若路径存在但不满足这些条件，立即失败
  - 初始化 bare repo 后，写入最小 repo-local state
  - repo-local state 只用于标记该 bare repo 由 sync 管理
  - 建议最小字段：

```text
git-md-publish.managed=true
git-md-publish.format=sync-target-v1
```

  - 初始化完成后，按本地 bare repo remote 处理

## Result Contract

- 运行时使用 in-memory fs 创建内部 repo。
- 若 tar 中读不到 `sourceCommit`，sync 失败。
- 若 tar payload 的 `mtime` 不一致，sync 失败。
- 若 host 缺少可用的 git identity，sync 失败。
- remote 同步必须把 `HEAD` 写到指定 branch。
- 若 `remote` 是本地 folder，则最终目标必须是 sync 创建或复用的 managed bare repo。
- 重复执行必须保持幂等。
