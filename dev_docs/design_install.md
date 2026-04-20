# Install Design

Status: draft.

## Goal

通过 `curl | sh` 在 user scope 安装 standalone binary。

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

- 安装脚本检测 host 的 OS / arch。
- 下载对应平台的 standalone binary。
- 不依赖 Node。
- 将 binary 写入 user-level bin 目录。
- 默认安装路径是：

```text
~/.local/bin/git-md-publish
```

- 若目录不存在，安装脚本创建该目录。
- 安装脚本将 binary 标记为可执行。
- 安装脚本检查该目录是否已在 `PATH` 中。
- 若该目录不在 `PATH` 中，安装脚本提供便捷添加功能。
- 便捷添加功能默认追加一行 shell 配置：

```text
export PATH="$HOME/.local/bin:$PATH"
```

- 安装脚本按当前 shell 选择用户级配置文件，例如 `.zshrc`、`.bashrc` 或 `.profile`。
- 若无法确定合适的配置文件，安装脚本输出明确提示，让用户手动添加。
- 安装后的调用方式是：

```text
git-md-publish <subcommand> ...
```

## Result Contract

- 安装成功后，user-level bin 目录中必须存在可执行的 `git-md-publish`。
- 若安装脚本声明 PATH 已就绪，则新 shell 中必须可直接调用 `git-md-publish`。
- 安装后的运行时不依赖 Node。
