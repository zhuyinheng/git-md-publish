# Tests Design

Status: draft.

## Goal

验证 `git-md-publish` 的本地能力和 GitHub 远端能力，并明确区分哪些测试在 local 跑，哪些测试在 remote 跑。

## Input

- local test runner
- remote test runner
- 网络访问
- `obsidian_test_vault`
- `obsidian_test_vault_live`
- host git
- GitHub 认证信息

repo 约定：

- `obsidian_test_vault` 是 source repo
- `obsidian_test_vault_live` 是 live target repo

## Output

成功或失败通过进程退出码表达。

- exit code `0`：测试通过
- non-zero：存在失败测试

stdout 和 stderr 只用于测试报告，不要求结构化 JSON。

## Behavior

- tests 分成 `local` 和 `remote` 两层。
- 划分规则是：
  - 任何不依赖 GitHub 认证、也不依赖 GitHub remote 的测试，都放在 `local`
  - 任何涉及 GitHub 认证或 GitHub remote 的测试，都放在 `remote`
- tests 可以访问网络。
- tests 为每个 case 创建独立临时目录。

- `local` tests:
  - 可通过 HTTPS 获取 `obsidian_test_vault`
  - 不要求 GitHub SSH key
  - 不向 GitHub remote push
  - 覆盖：
    - `scan`
    - `export`
    - `sync` 到本地 bare repo
    - `cli`
    - `install`
    - `release` 的本地产物生成
  - `scan` 验证：
    - public frontmatter
    - `README.md` 继承
    - markdown 引用收集
    - 输出路径稳定排序
  - `export` 验证：
    - 纯文本路径列表输入
    - tar 只包含请求文件
    - 缺失路径时报错
  - `sync` 验证：
    - tar 解包
    - `sourceCommit` 和 `mtime` 读取
    - snapshot commit 创建
    - push 到本地 bare repo 指定 branch
    - repo-local state 创建与复用
  - `cli` 验证：
    - `scan`
    - `export`
    - `sync`
    - `publish`
    - pipeline 接线正确
  - `install` 验证：
    - user-scope binary 安装
    - PATH 检查
    - PATH 追加辅助逻辑
  - `release` 验证：
    - release asset 文件名固定
    - 生成的 `install.sh` 包含正确 `releaseTag`
    - 生成的 `install.sh` 包含正确 GitHub Releases asset base URL
    - `install.sh` 可解析 host OS / arch 并选择对应 binary

- `remote` tests:
  - 只承载 GitHub 认证或 GitHub remote 行为
  - 必须使用 GitHub 凭证
  - source repo 使用 `obsidian_test_vault`
  - target repo 使用 `obsidian_test_vault_live`
  - 只在专用 live branch 上运行
  - 覆盖：
    - push 到 GitHub remote
    - GitHub 认证
    - live publish smoke
    - live end-to-end
    - release 的 GitHub 发布行为
  - `remote` publish smoke 验证：
    - 本地生成 publish 输入
    - push 到 `obsidian_test_vault_live` 指定 branch
    - 远端 branch 被正确更新
  - `remote` end-to-end 验证：
    - 从 `obsidian_test_vault` 读取 source commit
    - 运行完整 `publish`
    - 结果可在 `obsidian_test_vault_live` 指定 branch 观察到
  - `remote` release 验证：
    - GitHub Release 创建
    - release asset 上传
    - `install.sh` 下载路径可访问

## Result Contract

- `local` suite 必须在无 GitHub 凭证时可独立通过。
- `remote` suite 必须只包含 GitHub 认证或 GitHub remote 相关测试。
- `scan`、`export`、`sync` 到本地 bare repo、`cli`、`install`、`release` 本地产物测试必须全部在 `local`。
- push 到 GitHub remote、GitHub 凭证、live publish、live end-to-end、release 上传测试必须全部在 `remote`。
- `local` 和 `remote` 必须分别有独立入口。
