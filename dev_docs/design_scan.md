# Scan Design

Status: draft.

## Goal

给定一个 `git repo`，产出公开文件路径列表。

## Input

- `repoRoot`

路径语义固定为：

- repo-relative
- `/` 作为分隔符
- 大小写按 git path 精确匹配

## Output

标准输出是纯文本文件列表。

格式约定：

```text
notes/a.md
notes/b.md
assets/diagram.png
```

- 每行一个路径
- 只输出路径
- 输出顺序必须稳定

## Behavior

- 扫描对象是 `repoRoot` 当前 `HEAD` 的已提交树。
- Markdown 可见性规则：
  - 文件自身 `public: true|false` 优先级最高。
  - 若文件自身未显式设置，则向上查找所在目录及祖先目录里的 `README.md` frontmatter。
  - 只有显式 boolean 才终止继承。
  - YAML 解析失败产生 warning，并按“未设置”处理。
  - 最终默认值是 `false`。
- 文件收集规则：
  - public markdown 进入输出。
  - public markdown 实际引用到的非 markdown 文件进入输出。
- 引用规则：
  - 支持 standard link/image、reference-style link/image、wikilink、embed。
  - 扩展名为空的 markdown target，同时尝试 bare path 和 `.md`。
  - target 解析前先做 URL decode、angle-bracket trim、fragment / query / alias strip。
  - 对 standard link/image，外部 URL 直接忽略。
  - 目标存在时，按规则决定是否进入输出。
- tracked symlink 与 gitlink / submodule 跳过。

## Result Contract

- 成功时，stdout 只包含纯文本路径列表。
