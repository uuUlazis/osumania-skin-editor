# osu!mania 皮肤编辑器

一个面向 osu!mania 的图形化皮肤编辑器，用于读取皮肤目录、按 `Keys` 管理 `[Mania]` 小节，并对 `skin.ini` 中与下落式玩法相关的参数进行编辑。

界面基于 React + TypeScript + Vite，后端为 C++20，桌面端使用 WebView2 承载，前端资源会直接嵌入单个可执行文件。

## 功能

- 绑定 osu! Skins 目录并扫描其中的皮肤文件夹。
- 读取并编辑 `skin.ini` 中的 `[Mania]` 参数，按 `Keys`（1K-18K）区分配置。
- 支持各键数样式配置，并将不同皮肤的样式合并保存到 Skins 根目录的 JSON 文件中。
- 提供常用参数模块，如 `ColumnStart`、`ColumnWidth`、`BarlineHeight`、`HitPosition` 等。
- 提供面条身图像调整：
  - 图片留白与 alpha 识别
  - 顶部/左右留白与透明度修改
  - 框选、变换选区、自由变换
  - 撤销与重做
- 保存到当前图片，或通过系统窗口另存为
- 支持皮肤目录克隆、重命名、删除到回收站及目录操作撤销/重做。

## 技术栈

- React 18 + TypeScript + Vite
- C++20 + CMake + Ninja
- cpp-httplib、nlohmann/json、stb
- Windows WebView2

Powered by Ulazis
