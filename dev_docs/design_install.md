# Install Design

Status: draft.

## Goal

通过 `curl | sh` 在 user scope 安装 `git-md-publish`，同时兼顾"host 已有 Node"和"host 没有 Node"两种机器。

## Input

安装入口：

```text
curl -fsSL <install-url> | sh
```

## Output

成功或失败通过进程退出码表达。

- exit code `0`：安装成功
- non-zero：安装失败

成功时不要求结构化 stdout。

## Behavior

- 安装脚本先选择 channel：
  - 若 host 存在 `node` 且 major version ≥ 20，使用 **Node channel**
  - 否则使用 **Binary channel**
- channel 可被环境变量 `GIT_MD_PUBLISH_CHANNEL=node|binary` 强制覆盖

### Node channel

- 下载单文件 JS bundle `git-md-publish.cjs`。
- 写入 `~/.local/lib/git-md-publish/git-md-publish.cjs` 并标记可执行。
- 在 `~/.local/bin/git-md-publish` 写入一段 shell wrapper：

```sh
#!/bin/sh
exec node "$HOME/.local/lib/git-md-publish/git-md-publish.cjs" "$@"
```

- wrapper 使用 `exec` 以保证信号转发和 exit code 透传。
- Node channel 不依赖 standalone binary，不依赖 SEA / codesign，因此
  绕过 cross-platform Mach-O 签名等边界情况。

### Binary channel

- 安装脚本检测 host 的 OS / arch。
- 下载对应平台的 standalone binary。
- 将 binary 写入 `~/.local/bin/git-md-publish` 并标记可执行。
- Binary channel 不依赖 Node。

### 共同部分

- 默认 user-level bin 目录是：

```text
~/.local/bin
```

- 若目录不存在，安装脚本创建该目录。
- 安装脚本检查该目录是否已在 `PATH` 中。
- 若该目录不在 `PATH` 中，安装脚本提供便捷添加功能。
- 便捷添加功能默认追加一行 shell 配置：

```text
export PATH="$HOME/.local/bin:$PATH"
```

- 安装脚本按当前 shell 选择用户级配置文件，例如 `.zshrc`、`.bashrc`
  或 `.profile`。
- 若无法确定合适的配置文件，安装脚本输出明确提示，让用户手动添加。
- 安装后的调用方式是：

```text
git-md-publish <subcommand> ...
```

## Result Contract

- 安装成功后，`~/.local/bin/git-md-publish` 必须存在并可执行。
- 若 host 有 `node >= 20`：
  - 默认走 Node channel。
  - `~/.local/lib/git-md-publish/git-md-publish.cjs` 必须存在。
  - `~/.local/bin/git-md-publish` 是 wrapper，运行时委托给 Node。
- 若 host 没有 `node` 或 Node 版本不足：
  - 走 Binary channel。
  - `~/.local/bin/git-md-publish` 直接就是 standalone binary，运行时
    不依赖 Node。
- 若安装脚本声明 PATH 已就绪，则新 shell 中必须可直接调用
  `git-md-publish`。
