# Scan Design

Status: draft.

## Goal

给定一个 `git repo`，产出公开文件路径列表和 broken reference 列表。

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

broken reference 和解析 warning 走 stderr，格式为：

```text
scan: broken reference (missing): from/path.md -> target/path
scan: broken reference (not-public): from/path.md -> target/path.md
scan: failed to parse YAML frontmatter: bad.md: <yaml error>
```

## Behavior

- 扫描对象是 `repoRoot` 当前 `HEAD` 的已提交树。
- 跳过 gitlink / submodule。
- **symlink 不做特殊处理**：保留在 blob 集合中，`git archive` 在 export
  阶段把 symlink blob 原样打进 tar；scan 不尝试解析 symlink target。

### Frontmatter

frontmatter 解析基于：

- `vfile-matter`

实现只认：

```yaml
public: true
public: false
```

规则：

- 文件自身 `public` 优先
- 若未显式设置，则向上查找当前目录及祖先目录的 `README.md`
- 只有显式 boolean 才终止继承
- 非 boolean、缺失、或 YAML 解析失败 → 视为未设置，继续继承
- YAML 解析失败会产生 warning
- 找不到则默认为 `false`

### 文件收集规则

对每个 markdown 文件判定 public 后：

- 是 public → 进入输出
- 非 public → 不进入输出

对每个 public markdown 文件，走引用规则收集它引用的非 markdown 文件。

### 引用规则

正文 AST 解析基于：

- `remark-parse`
- `remark-gfm`
- `@flowershow/remark-wiki-link`

支持的引用形式：

- standard markdown link：`[text](target)`
- standard markdown image：`![alt](target)`
- reference-style link：`[text][label]` + `[label]: target`
- reference-style image：`![alt][label]` + `[label]: target`
- wikilink：`[[target]]`
- embed：`![[target]]`

target 规范化：

- 去掉 angle-bracket wrapping `<...>`
- 去掉 fragment（`#...`）和 query（`?...`）
- URL decode

对 standard / reference 链接，如果 target 带 scheme（`http:`、`https:`、
`mailto:`、其他 `scheme:`）或以 `//` 开头，视为外部链接，忽略。

target 解析顺序：

1. 以引用者所在目录为 base 解析为仓库相对路径；命中 tracked → 返回
2. 若 target 无扩展名，尝试加 `.md` 再命中一次
3. 若 target 是单段（不含 `/`），回退到 basename index 查找
   - basename index 仅在该 basename 在仓库内唯一时有效；否则跳过
   - 无扩展名时，basename fallback 也会同时尝试加 `.md`
4. wikilink 以 `/` 开头视为仓库根相对

### broken reference 规则

对每条引用：

- 目标解析到 markdown：
  - 若目标是 public markdown：不额外记录（该文件已经通过可见性规则进入输出）
  - 若目标是非 public markdown：记 broken reference，`reason = "not-public"`
  - 若目标不存在于 tracked：记 broken reference，`reason = "missing"`
- 目标解析到非 markdown 文件：
  - 若存在：加入输出
  - 若不存在：记 broken reference，`reason = "missing"`

broken reference 不会把 private markdown 强行带入输出。

## Result Contract

- 成功时，stdout 只包含纯文本路径列表。
- 每个 broken reference 必须在 stderr 上出现一次，格式：
  `broken reference (<reason>): <from> -> <target>`。
- `reason` 取值：`missing` | `not-public`。
