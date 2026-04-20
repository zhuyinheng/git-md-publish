# Release Design

Status: draft.

## Goal

从这个 project repo 构建、校验并发布 installer 和 standalone binaries，使其可通过公开 URL 安装。

## Input

- project repo
- `releaseTag`
- GitHub Actions runner
- GitHub repository release permissions

`releaseTag` 约定：

- 使用版本 tag，例如 `v0.1.0`

## Output

成功或失败通过进程退出码表达。

- exit code `0`：release 成功
- non-zero：release 失败

成功时不要求结构化 stdout。

## Behavior

- release 采用 GitHub Actions + GitHub Releases。
- 主要触发方式是 push version tag。
- 可选保留 `workflow_dispatch` 作为手动重跑入口。
- workflow checkout `releaseTag` 对应的 ref。
- workflow 先运行 release 所需测试。
- workflow 构建各平台 standalone binary。
- workflow 生成最终的 `install.sh`。
- `install.sh` 内必须携带 tag-specific asset base URL：

```text
https://github.com/<owner>/<repo>/releases/download/<releaseTag>
```

- workflow 为同一 `releaseTag` 创建 GitHub Release。
- GitHub Release 初始状态建议为 draft。
- workflow 先上传各平台 binary，再上传 `install.sh`。
- 所有 assets 上传成功后，再将 release 发布。
- 发布的 asset 文件名固定为：

```text
install.sh
git-md-publish-darwin-arm64
git-md-publish-darwin-x64
git-md-publish-linux-arm64
git-md-publish-linux-x64
```

- 用户安装入口是：

```text
https://github.com/<owner>/<repo>/releases/latest/download/install.sh
```

## Result Contract

- 成功后，`releaseTag` 对应的 GitHub Release 必须包含 `install.sh` 和各平台 binary。
- 成功后，tag-specific 下载路径必须存在：

```text
https://github.com/<owner>/<repo>/releases/download/<releaseTag>/install.sh
```

- 若该 release 是最新 release，则以下入口必须成立：

```text
curl -fsSL https://github.com/<owner>/<repo>/releases/latest/download/install.sh | sh
```

- `install.sh` 必须仅依赖 host 的 OS / arch 选择下载目标 binary。
