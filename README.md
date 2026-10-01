# osu!mania 皮肤编辑器

一个面向 osu!mania 的图形化皮肤编辑器，用于读取皮肤目录、按 `Keys` 管理 `[Mania]` 小节，并对 `skin.ini` 中与mania模式相关的参数进行编辑。

界面基于 React + TypeScript + Vite，后端为 C++20，桌面端使用 WebView2 承载，前端资源会直接嵌入单个可执行文件。

当前版本为 `0.1.4`，历史版本见 Releases 页面。

## 功能

- 绑定 osu! Skins 目录并扫描其中的皮肤文件夹。
- 读取并编辑 `skin.ini` 中的 `[Mania]` 参数，按 `Keys`（1K-18K）区分配置。
- 支持各键数样式配置，并将不同皮肤的样式合并保存到 Skins 根目录的 JSON 文件中。
- 提供常用参数模块，如 `ColumnStart`、`ColumnWidth`、`BarlineHeight`、`HitPosition` 等。
- 提供皮肤预览面板：按 osu! 以 480 高度为基准的坐标系渲染当前键数模块的轨道背景、音符、面条、判定线，以及分数/连击 HUD。
- 提供面条身图像调整：
  - 图片留白与 alpha 识别
  - 顶部/左右留白与透明度修改
  - 框选、变换选区、自由变换
  - 撤销与重做
- 保存到当前图片，或通过系统窗口另存为
- 支持皮肤目录克隆、重命名、删除到回收站及目录操作撤销/重做。
- 面条身图像工具提供「贴合面身（单边）」边线绘制：先填线宽与 RGBA 颜色，再单选上/下/左/右生成预览线，拖动时自动吸附到画布外缘、面身包围盒或逐行/逐列轮廓（按住 Alt 拖动暂时关闭吸附），按 Enter 或点「渲染这条线」绘制，Esc 取消，可撤销/重做。

## 本版更新（0.1.4）

- 单数 key 的中央列按官方 `mania-noteS` / `mania-keyS` 取图：奇数键数小节（1K/3K/5K/7K/9K…）的中央列判定为特殊列，与 lazer 的 `StageDefinition.IsSpecialColumn` 一致；键数为大于 4 的偶数且 `SpecialStyle` 为 1/2 时保留左右端兜底。
- 缺少 `mania-noteS` / `mania-keyS` 贴图时回落到该列普通贴图（`mania-note1/2`、`mania-key1/2`），不再整列空白。
- 预览视野固定为「整屏」（完整的 768x480 空间），移除界面上的「视野」下拉与预览图例；预览舞台块在预览面板中垂直居中（面板过矮时退回顶部并可滚动）。
- 面条身图像工具新增「贴合面身（单边）」（`POST /api/skin/image/local/profile` 取轮廓，`POST /api/skin/image/local/border-line` 绘制），绘制结果进入局部撤销/重做历史。
