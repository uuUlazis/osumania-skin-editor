# AGENTS.md — osu!mania 皮肤 skin.ini 编辑器

## 1. 项目目标

构建一个可直接运行的图形化 osu!mania 皮肤编辑器，核心能力如下：

1. 绑定 osu! 的 Skins 皮肤目录（Windows 文件夹选择框）。
2. 绑定后扫描该目录下的直接子文件夹，以每个子文件夹的**文件夹名称**生成皮肤列表。
3. 从列表中选择某个皮肤，读取并编辑其文件夹内的 `skin.ini`。
4. 解析 `skin.ini` 中所有 `[Mania]` 小节，按各小节 `Keys:` 的数值区分编辑目标（1K、2K、3K、4K、5K、6K、7K、8K、9K、10K、12K、14K、16K、18K）。
5. 只编辑与 osu!mania 下落式玩法相关的参数；非 mania 参数保留原样。
6. 参数语义、默认值与校验规则以官方中文 wiki 为准：<https://osu.ppy.sh/wiki/zh/Skinning/skin.ini>

最终交付物：Windows 上双击即可运行的图形化编辑器（单个 exe，内嵌前端资源，WebView2 承载界面）。

## 2. 技术选型

- 前端：React + TypeScript + Vite，构建为静态 SPA；界面为桌面工具风格，不做营销页。
- 后端：C++20，负责全部文件系统访问、`skin.ini` 解析与写入，通过本机 HTTP 服务向前端提供 API。
- 桌面壳：Windows WebView2 嵌入 React 界面；无 WebView2 时回退到系统默认浏览器。
- 关键库：
  - cpp-httplib（本机 HTTP 服务器，header-only）
  - nlohmann/json（JSON 序列化）
  - C++ 标准库 `<filesystem>`（目录扫描与路径处理）
  - Windows API `IFileDialog`（原生文件夹选择）、WebView2（界面承载）
- 构建：CMake + Visual Studio 2022（MSVC）；前端由 npm 构建后嵌入 exe。

## 3. 目录结构

```text
mania skin editor/
├── AGENTS.md
├── CMakeLists.txt
├── backend/
│   ├── src/
│   │   ├── main.cpp          # 入口：启动 HTTP 服务并打开 WebView2 窗口
│   │   ├── http/             # HTTP 服务与 API 路由
│   │   ├── ini/              # ini 解析器、数据模型、序列化
│   │   ├── skins/            # 皮肤目录扫描与路径安全校验
│   │   └── webview/          # WebView2 壳
│   ├── third_party/          # cpp-httplib、nlohmann/json
│   └── tests/                # C++ 单元测试
├── frontend/
│   ├── src/
│   │   ├── api/client.ts
│   │   ├── components/       # 皮肤列表、key 切换、字段编辑控件
│   │   └── pages/            # 主编辑页
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
├── test/
│   └── Skins/                # 现成的真实皮肤测试夹具（勿破坏）
└── docs/
```

## 4. skin.ini 解析规则

### 4.1 语法

- INI 格式：小节 `[Mania]`，条目为 `键: 值`（冒号后可有空白）。
- 小节名与键名大小写不敏感；写入时尽量保留原始大小写。
- `//` 开头为注释；空行、注释和未知键必须保留，保证“保存后与原文 diff 最小”。
- 一个 `[Mania]` 小节从该行开始，直到下一个 `[X]` 小节标题前结束。
- 官方要求：每种键数**必须**独立成小节，同一个 `skin.ini` 可以有多个 `[Mania]`。
- `Keys:` 只接受：`1,2,3,4,5,6,7,8,9,10,12,14,16,18`。

### 4.2 保留策略

- `[General]`、`[Colours]`、`[Fonts]`、`[CatchTheBeat]` 等其他小节原样保留，不提供编辑。
- 未建模的未知键原样保留在所属 `[Mania]` 小节内。
- 只替换、新增或删除已建模键的条目；注释与行顺序尽量不动。
- 保存前自动在皮肤目录生成 `skin.ini.bak` 备份；写入采用原子替换（先写临时文件，再重命名）。
- 文件按 UTF-8 读写；若原文件带 BOM，保存时保留 BOM。

### 4.3 与键数相关的列表值

官方规则：

- 列相关列表值（如 `ColumnWidth`、`ColumnLineWidth`、`Colour#`、`NoteImage#`）数量超过键数时，多余值忽略。
- 数量不足时，缺失值使用默认值。
- 编辑器按所选键数渲染 N 个输入槽位；用户可补足或留空，保存时按实际值输出。
- 水平位置参数以 480 像素高度为基准，控件提示中应注明。

### 4.4 版本要求

- 自定义 mania 舞台需要 `[General] Version:` 为 2.5 或更高。
- 用户修改依赖 2.5+ 的参数（翻转系列、`NoteBodyStyle` 等）时，编辑器应提示，并可自动将 `Version` 改为 `latest`。

## 5. [Mania] 参数模型（官方参考）

以下字段、类型与默认值来自参考网页。**# 的列索引从 0 到 keys-1；颜色系列的 `Colour#` / `ColourLight#` 的编号从 1 开始**，两者易混，须在 UI 中区分说明。

### 5.1 布局与判定

| 参数 | 格式 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `Keys` | 枚举整数 | 无 | 必填；该小节对应的键数 |
| `ColumnStart` | 数字 | 136 | 最左列起始位置 |
| `ColumnRight` | 数字 | 19 | 列最右可绘制位置 |
| `ColumnSpacing` | 逗号分隔数字列表 | 0 | 列与列之间的间距 |
| `ColumnWidth` | 逗号分隔数字列表 | 30 | 每列宽度；键数多时建议更小 |
| `ColumnLineWidth` | 逗号分隔数字列表 | 2 | 列间分隔线宽度 |
| `BarlineHeight` | 数字 | 1.2 | 小节线宽度 |
| `LightingNWidth` | 逗号分隔数字列表 | 空 | 每列 `LightingN` 宽度 |
| `LightingLWidth` | 逗号分隔数字列表 | 空 | 每列 `LightingL` 宽度 |
| `WidthForNoteHeightScale` | 数字 | 与最小列宽成正比 | 列宽不同时的音符高度基准 |
| `HitPosition` | 整数 | 402 | 判定线绘制高度 |
| `LightPosition` | 整数 | 413 | 游玩区域闪光高度（仅 `StageLight`） |
| `ScorePosition` | 整数 | 舞台垂直居中 | 打击结果出现高度 |
| `ComboPosition` | 整数 | 舞台垂直居中 | 连击计数器出现高度 |
| `JudgementLine` | 0/1 | - | `StageHint` 上方是否再画一条提示线 |
| `LightFramePerSecond` | 整数 | 未知 | `StageLight` 动画帧率 |

### 5.2 特殊键与舞台

| 参数 | 格式 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `SpecialStyle` | 0/1/2 | 0 | 0 无；1 左(SP)/外(DP)；2 右(SP)/内(DP)；仅适用于大于 4 的偶数键 |
| `ComboBurstStyle` | 0/1/2 或 Left/Right/Both | 1 | 连击提示图位置；支持单词或数值 |
| `SplitStages` | 0/1 | 未定义 | 是否分割舞台；定义时必须给值 |
| `StageSeparation` | 数字 | 40 | 舞台分割时两舞台间距 |
| `SeparateScore` | 0/1 | 1 | 打击结果是否只显示在得分舞台 |
| `KeysUnderNotes` | 0/1 | 0 | 音符经过按键时按键是否被覆盖 |
| `UpsideDown` | 0/1 | 0 | 舞台是否上下颠倒 |

### 5.3 翻转系列（均需皮肤版本高于 2.5）

| 参数 | 格式 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `KeyFlipWhenUpsideDown` | 0/1 | 1 | 颠倒时所有按键翻转 |
| `KeyFlipWhenUpsideDown#` | 0/1 | - | 颠倒时指定列按键翻转 |
| `KeyFlipWhenUpsideDown#D` | 0/1 | - | 颠倒时指定列已按下按键翻转 |
| `NoteFlipWhenUpsideDown` | 0/1 | 1 | 颠倒时所有音符翻转 |
| `NoteFlipWhenUpsideDown#` | 0/1 | - | 颠倒时指定列音符翻转 |
| `NoteFlipWhenUpsideDown#H` | 0/1 | - | 颠倒时指定列长按音符头翻转 |
| `NoteFlipWhenUpsideDown#L` | 0/1 | - | 颠倒时指定列长按音符体翻转 |
| `NoteFlipWhenUpsideDown#T` | 0/1 | - | 颠倒时指定列长按音符尾翻转 |

### 5.4 长按样式（需皮肤版本高于 2.5）

| 参数 | 格式 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `NoteBodyStyle` | 0/1/2 | 1 | 所有列的长按音符体样式 |
| `NoteBodyStyle#` | 0/1/2 | - | 指定列的长按音符体样式 |

### 5.5 颜色

| 参数 | 格式 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `Colour#` | RGB(a) | 0,0,0,255 | 指定列背景；`#` 从 1 开始 |
| `ColourLight#` | RGB | 55,255,255 | 指定列闪光；`#` 从 1 开始 |
| `ColourColumnLine` | RGB(a) | 255,255,255,255 | 列间分隔线颜色 |
| `ColourBarline` | RGB(a) | 255,255,255,255 | 小节线颜色 |
| `ColourJudgementLine` | RGB | 255,255,255 | 判定线颜色 |
| `ColourKeyWarning` | RGB | 0,0,0 | 按键绑定提示颜色 |
| `ColourHold` | RGB(a) | 255,191,51,255 | 长按音符时连击计数器颜色 |
| `ColourBreak` | RGB | 255,0,0 | 断连时连击计数器颜色 |

### 5.6 图像（值为相对皮肤根目录的图片文件名）

| 参数 | 格式 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `KeyImage#` | 文本（图片路径） | - | 指定列未按下按键 |
| `KeyImage#D` | 文本（图片路径） | - | 指定列已按下按键 |
| `NoteImage#` | 文本（图片路径） | - | 指定列音符 |
| `NoteImage#H` | 文本（图片路径） | - | 指定列长按音符头 |
| `NoteImage#L` | 文本（图片路径） | - | 指定列长按音符体 |
| `NoteImage#T` | 文本（图片路径） | - | 指定列长按音符尾 |
| `StageLeft` / `StageRight` | 文本（图片路径） | - | 舞台左右边界 |
| `StageBottom` | 文本（图片路径） | - | 游玩区域底部（不拉伸） |
| `StageHint` | 文本（图片路径） | - | 图形判定线 |
| `StageLight` | 文本（图片路径） | - | 每列闪光 |
| `LightingN` / `LightingL` | 文本（图片路径） | - | 音符 / 长按音符闪光 |
| `WarningArrow` | 文本（图片路径） | - | 开始前的警告箭头 |
| `Hit0` / `Hit50` / `Hit100` / `Hit200` / `Hit300` / `Hit300g` | 文本（图片路径） | - | 各档打击判定图像 |

## 6. 后端 API

约定：本机地址 `http://127.0.0.1:{port}/api`，JSON 请求与响应。

| 方法与路径 | 功能 |
| --- | --- |
| `GET /api/health` | 健康检查 |
| `POST /api/skin-dir/pick` | 打开系统文件夹选择框，返回绑定目录 |
| `POST /api/skin-dir/open` | 接收 `{ path }`，校验并扫描目录，返回皮肤列表 |
| `GET /api/skin` | 解析指定皮肤的 `skin.ini`，返回 `[Mania]` 模块与原始结构 |
| `PUT /api/skin/mania` | 接收 `{ path, keys, entries }`，应用单个键数模块的修改并原子保存 |
| `GET /api/skin/ini` | 返回 `skin.ini` 原始文本（只读预览） |
| `POST /api/skin/validate` | 校验全部 `[Mania]`：Keys 合法性、重复、列表值数量，返回警告 |

扫描规则：

- 只列绑定目录下的**直接子文件夹**；文件夹名即皮肤名。
- 有 `skin.ini` 的皮肤返回可用键数；无 `skin.ini` 的皮肤标记为缺失，允许创建默认模板。
- 路径安全：所有路径必须解析后位于已绑定的皮肤目录内；拒绝 `..`、符号链接逃逸和绝对路径外传。

## 7. 前端界面

单页应用，三步工作流：

1. 顶部工具栏：绑定目录按钮、当前目录路径、刷新按钮。
2. 左侧皮肤列表：按文件夹名列出；显示可用键数徽标；无 `skin.ini` 的皮肤标黄并允许创建模板。
3. 主编辑区：
   - 顶部用 segmented control 或 tabs 切换键数模块（1K、2K、…、18K），只展示该皮肤中存在的模块；缺失模块灰显。
   - 表单按 5.1 至 5.6 分组：布局与判定、特殊舞台、翻转、长按样式、颜色、图像。
   - 列相关字段按当前键数渲染 N 个输入槽位，槽位数稳定、不随内容伸缩。
   - 颜色字段使用颜色选择器 + 透明度输入；图像字段提供相对皮肤目录的浏览按钮与存在性校验。
   - 右上角提供保存、还原、备份；未保存修改显示 dirty 标记；保存成功显示改动摘要。
   - 底部或抽屉提供只读原始 `skin.ini` 预览，便于对照。

组件图标优先使用 lucide-react；界面为安静的桌面工具风格，保持高信息密度与稳定布局。

## 8. 构建与运行（最终目标）

运行环境：Windows 10/11，WebView2 Runtime（Windows 11 自带）。

```powershell
npm --prefix frontend ci
npm --prefix frontend run build
cmake -S . -B build
cmake --build build --config Release
.\build\Release\ManiaSkinEditor.exe
```

运行方式：

- exe 内嵌 `frontend/dist` 静态资源。
- 后端在 `127.0.0.1` 上使用随机本机端口启动；端口冲突时自动换端口。
- 启动后打开 WebView2 窗口，即最终图形界面。

开发模式：

- 后端单独运行并提供 API；前端使用 Vite dev server，将 `/api` 代理到后端。
- 开发环境端口固定为 8080（可配置），生产环境不暴露端口号。

## 9. 测试策略

- 单元测试：ini 解析 round-trip（注释、空行、未知键、大小写保留）；`[Mania]` 按 Keys 分组；Keys 合法性校验；列列表值补全规则；原子保存与备份。
- 夹具测试：直接使用 `test/Skins` 下现有真实皮肤（含 1K 至 18K 多模块）验证解析与保存 diff。
- 集成测试：临时目录构造 `skin.ini`，验证 API 读写与路径安全。
- 前端测试：Vitest 覆盖表单校验；Playwright e2e 覆盖“绑定目录 → 选择皮肤 → 切换键数 → 修改字段 → 保存”。
- 保存测试必须断言：非 mania 内容、注释、未知键未被破坏。

## 10. 里程碑

- M1 骨架：CMake + cpp-httplib + React 壳，目录绑定与皮肤列表。
- M2 解析：round-trip 解析器、按 Keys 分组的 `[Mania]` 模型、后端 API。
- M3 编辑：全部 mania 字段表单、校验、备份与原子保存。
- M4 打包：WebView2 单 exe、端到端测试，交付可直接运行。

## 11. 非目标

- 不编辑 `[General]`、`[Colours]`、`[Fonts]`、`[CatchTheBeat]` 的参数（仅保留原样）。
- 不做图片资源本身的修改、生成或预览。
- 不自动定位 osu! 安装路径；由用户手动绑定 Skins 目录。
- 不做谱面编辑、在线下载等扩展功能。

## 12. 开发约束

- `skin.ini` 的解析与写入必须全部由 C++ 后端完成，前端不得直接读写文件系统。
- 任何保存操作前必须备份，禁止覆盖用户原始 `skin.ini` 而不可恢复。
- 前端只做展示、表单与调用 API；所有路径类操作必须经过后端校验。
- 修改依赖 2.5+ 的参数时，需提示并处理 `[General] Version`。
