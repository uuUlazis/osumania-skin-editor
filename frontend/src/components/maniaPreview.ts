// osu!mania 皮肤预览的纯计算逻辑。
//
// 坐标系：skin.ini 的水平/垂直位置都以「高度 480」为基准，
// 因此宽度 = 480 × 画面宽高比（预览默认 16:9）。
// osu! 内部按 1.6 倍换算到 768 空间（LegacySkin.STABLE_MAGIC_SCALE_FACTOR）。
//
// 依据 osu!lazer 源码（ppy/osu master）：
//  - LegacyManiaColumnElement.FallbackColumnIndex：
//      特殊列 -> "S"；否则按到同 stage 边缘的距离奇偶 -> "1" / "2"；
//  - ColumnFlow：列宽 = ColumnWidth[i]、列间距 = ColumnSpacing[i]，整体水平居中；
//  - LegacyNotePiece：note 宽 = 列宽，高 = noteHeightScale × (图高/图宽)，
//      noteHeightScale 缺省时取最窄列宽；
//  - LegacyKeyArea：key 宽 = 列宽、高 = 贴图原始高度（不缩放），底边贴舞台底边；
//  - LegacyStageBackground：列底色不透明度 = A²，列线只覆盖判定线以上、
//      实绘宽度 = ColumnLineWidth × 0.74（且不乘 1.6）。

export const PLAYFIELD_HEIGHT = 480;
export const STABLE_SCALE = 1.6;
export const DEFAULT_ASPECT = 16 / 9;

export const DEFAULT_COLUMN_WIDTH = 30;
export const DEFAULT_COLUMN_START = 136;
export const DEFAULT_COLUMN_SPACING = 0;
export const DEFAULT_COLUMN_LINE_WIDTH = 2;
export const DEFAULT_HIT_POSITION = 402;
export const DEFAULT_LIGHT_POSITION = 413;
export const DEFAULT_BARLINE_HEIGHT = 1.2;
export const DEFAULT_NOTE_BODY_STYLE = 3;

/** ColumnLineWidth 在 lazer 中不乘 1.6，绘制时再乘 0.74。 */
export const COLUMN_LINE_SCALE = 0.74 / STABLE_SCALE;

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface PreviewColumn {
  index: number;
  x: number;
  width: number;
  leftLine: number;
  rightLine: number;
  isSpecial: boolean;
  token: string;
  background: Rgba;
  light: Rgba;
}

export interface PreviewStage {
  columns: PreviewColumn[];
  left: number;
  right: number;
}

export interface PreviewLayout {
  keys: number;
  aspect: number;
  width: number;
  height: number;
  columns: PreviewColumn[];
  stages: PreviewStage[];
  stageLeft: number;
  stageRight: number;
  hitPosition: number;
  lightPosition: number;
  comboPosition: number | null;
  scorePosition: number | null;
  barlineHeight: number;
  noteHeightScale: number;
  centred: boolean;
  explicitStart: boolean;
  split: boolean;
}

const OPAQUE_BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };
const DEFAULT_LIGHT: Rgba = { r: 55, g: 255, b: 255, a: 1 };

export function numeric(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function optionalNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') {
    return null;
  }
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function numericList(value: string | undefined): number[] {
  if (!value) {
    return [];
  }
  const out: number[] = [];
  for (const part of value.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '') {
      continue;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      out.push(parsed);
    }
  }
  return out;
}

/** osu! 的列表参数：缺少的下标保留全局默认值，多余的值被忽略。 */
export function pickAt(list: number[], index: number, fallback: number): number {
  return index < list.length ? list[index] : fallback;
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function parseColor(value: string | undefined, fallback: Rgba): Rgba {
  if (!value) {
    return fallback;
  }
  const parts = value.split(',').map((part) => part.trim());
  if (parts.length < 3) {
    return fallback;
  }
  const channels = parts.slice(0, 3).map((part) => Number(part));
  if (channels.some((channel) => !Number.isFinite(channel))) {
    return fallback;
  }
  const alpha = parts.length >= 4 ? Number(parts[3]) : NaN;
  return {
    r: clampChannel(channels[0]),
    g: clampChannel(channels[1]),
    b: clampChannel(channels[2]),
    a: Number.isFinite(alpha) ? clampChannel(alpha) / 255 : 1,
  };
}

/** legacy 皮肤的颜色最终不透明度是 A²（LegacyColourCompatibility）。 */
export function squaredAlpha(color: Rgba): Rgba {
  return { ...color, a: color.a * color.a };
}

export function rgba(color: Rgba): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`;
}

/** osu! 默认贴图按列位置回退（特殊列 -> S，其余按到边缘距离奇偶）。 */
export function fallbackToken(inStageIndex: number, stageCount: number, isSpecial: boolean): string {
  if (isSpecial) {
    return 'S';
  }
  const distance = Math.min(inStageIndex, stageCount - 1 - inStageIndex);
  return distance % 2 === 0 ? '1' : '2';
}

function specialStyleNumber(raw: string | undefined): number {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === 'left') {
    return 1;
  }
  if (value === 'right') {
    return 2;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface LayoutOptions {
  keys: number;
  value: (name: string) => string;
  centre: boolean;
  aspect: number;
}

export function buildLayout({ keys, value, centre, aspect }: LayoutOptions): PreviewLayout {
  const width = PLAYFIELD_HEIGHT * aspect;
  const widths: number[] = [];
  const spacings: number[] = [];
  const lineWidths: number[] = [];
  for (let i = 0; i < keys; i++) {
    widths.push(pickAt(numericList(value('ColumnWidth')), i, DEFAULT_COLUMN_WIDTH));
    spacings.push(pickAt(numericList(value('ColumnSpacing')), i, DEFAULT_COLUMN_SPACING));
  }
  const lineSource = numericList(value('ColumnLineWidth'));
  for (let i = 0; i <= keys; i++) {
    lineWidths.push(pickAt(lineSource, i, DEFAULT_COLUMN_LINE_WIDTH));
  }

  const splitValue = value('SplitStages').trim();
  const split = splitValue === '1' || (keys > 9 && splitValue !== '0');
  const firstStageCount = split ? Math.ceil(keys / 2) : keys;
  const ranges: Array<{ from: number; to: number }> = split
    ? [
        { from: 0, to: firstStageCount },
        { from: firstStageCount, to: keys },
      ]
    : [{ from: 0, to: keys }];

  const gap = split ? numeric(value('StageSeparation'), 40) : 0;
  const stageWidth = (from: number, to: number): number => {
    let total = 0;
    for (let i = from; i < to; i++) {
      total += widths[i];
      if (i < to - 1) {
        total += spacings[i];
      }
    }
    return total;
  };

  const totalWidth = ranges.reduce((sum, range) => sum + stageWidth(range.from, range.to), 0)
    + gap * Math.max(0, ranges.length - 1);

  const rawStart = value('ColumnStart').trim();
  const explicitStart = rawStart !== '';
  const start = centre
    ? (width - totalWidth) / 2
    : numeric(rawStart, DEFAULT_COLUMN_START);

  const style = specialStyleNumber(value('SpecialStyle'));
  const isSpecial = (index: number): boolean => {
    if (keys <= 4 || keys % 2 !== 0 || (style !== 1 && style !== 2)) {
      return false;
    }
    if (style === 1) {
      return index === 0;
    }
    return split ? index === firstStageCount - 1 : index === keys - 1;
  };

  const columns: PreviewColumn[] = [];
  const stages: PreviewStage[] = [];
  let cursor = start;

  ranges.forEach((range, stageIndex) => {
    const stageColumns: PreviewColumn[] = [];
    const stageCount = range.to - range.from;
    for (let i = range.from; i < range.to; i++) {
      const special = isSpecial(i);
      const column: PreviewColumn = {
        index: i,
        x: cursor,
        width: widths[i],
        leftLine: lineWidths[i] * COLUMN_LINE_SCALE,
        rightLine: lineWidths[i + 1] * COLUMN_LINE_SCALE,
        isSpecial: special,
        token: fallbackToken(i - range.from, stageCount, special),
        background: parseColor(value(`Colour${i + 1}`), OPAQUE_BLACK),
        light: parseColor(value(`ColourLight${i + 1}`), DEFAULT_LIGHT),
      };
      stageColumns.push(column);
      columns.push(column);
      cursor += widths[i];
      if (i < range.to - 1) {
        cursor += spacings[i];
      }
    }
    if (stageColumns.length > 0) {
      const first = stageColumns[0];
      const last = stageColumns[stageColumns.length - 1];
      stages.push({ columns: stageColumns, left: first.x, right: last.x + last.width });
    }
    if (stageIndex < ranges.length - 1) {
      cursor += gap;
    }
  });

  const stageLeft = columns.length > 0 ? columns[0].x : start;
  const stageRight = columns.length > 0
    ? columns[columns.length - 1].x + columns[columns.length - 1].width
    : start + totalWidth;

  const comboRaw = value('ComboPosition').trim();
  const scoreRaw = value('ScorePosition').trim();
  const noteScale = optionalNumber(value('WidthForNoteHeightScale'));
  // 源码：WidthForNoteHeightScale 未设置/<=0 时取「最窄列宽」（不是 30，也不能把默认值掺进最小值）
  const noteHeightScale =
    noteScale !== null && noteScale > 0
      ? noteScale
      : widths.length > 0
        ? Math.min(...widths)
        : DEFAULT_COLUMN_WIDTH;

  const hitRaw = numeric(value('HitPosition'), DEFAULT_HIT_POSITION);

  return {
    keys,
    aspect,
    width,
    height: PLAYFIELD_HEIGHT,
    columns,
    stages,
    stageLeft,
    stageRight,
    hitPosition: Math.max(240, Math.min(480, hitRaw)),
    lightPosition: numeric(value('LightPosition'), DEFAULT_LIGHT_POSITION),
    comboPosition: comboRaw === '' ? null : numeric(comboRaw, 111),
    scorePosition: scoreRaw === '' ? null : numeric(scoreRaw, 300),
    barlineHeight: numeric(value('BarlineHeight'), DEFAULT_BARLINE_HEIGHT) / STABLE_SCALE,
    noteHeightScale,
    centred: centre,
    explicitStart,
    split,
  };
}

/** note 长按体样式：0 = 拉伸，其余 = 平铺（lazer 只区分这两档）。 */
export function resolveBodyStyle(raw: string | undefined, version: string | null | undefined): number {
  const parsed = optionalNumber(raw);
  if (parsed !== null) {
    return parsed;
  }
  const major = parseFloat(String(version ?? '').replace(/[^0-9.]/g, ''));
  if (Number.isFinite(major) && major >= 2.5) {
    return DEFAULT_NOTE_BODY_STYLE;
  }
  return String(version ?? '').trim().toLowerCase() === 'latest' ? DEFAULT_NOTE_BODY_STYLE : 0;
}

export type ImageIndex = Map<string, string>;

export function buildImageIndex(paths: string[], preferAt2x = true): ImageIndex {
  const index: ImageIndex = new Map();
  // 皮肤里常有大量「变体子文件夹」（Change\Mod\... ），同名贴图会出现多份。
  // stable 的查找顺序是皮肤根目录优先，子目录只在 skin.ini 明确写了相对路径时才用，
  // 所以按层级浅 -> 深排序，保证根目录文件先入索引、赢得同名冲突。
  const ordered = [...paths].sort((a, b) => {
    const da = (a.match(/[\\/]/g) ?? []).length;
    const db = (b.match(/[\\/]/g) ?? []).length;
    return da - db;
  });
  // 同名贴图同时存在 x.png 与 x@2x.png 时：默认优先 @2x（读取尺寸时统一折半），
  // 关掉 @2x 开关则优先 1x。
  const put = (key: string, value: string) => {
    const existing = index.get(key);
    if (!existing) {
      index.set(key, value);
      return;
    }
    const existingIs2x = /@2x/i.test(existing);
    const valueIs2x = /@2x/i.test(value);
    if (existingIs2x !== valueIs2x && valueIs2x === preferAt2x) {
      index.set(key, value);
    }
  };
  for (const path of ordered) {
    const rel = path.replace(/\\/g, '/');
    const lower = rel.toLowerCase();
    put(lower, rel);
    // stable 的贴图查找是按「相对皮肤根目录的路径」，不会用文件名去子目录里搜。
    // 因此只有根目录文件才登记「裸文件名」键，子目录文件只能用完整相对路径命中
    // （例如 Change\Note\...\mania-note1T.png 不能再被隐式的 mania-note1T 取到）。
    if (!lower.includes('/')) {
      const noExt = lower.replace(/\.[^.]+$/, '');
      if (noExt) {
        put(noExt, rel);
      }
    }
  }
  return index;
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

/** 把 skin.ini 里的图片引用解析成皮肤目录内的相对路径。 */
export function resolveImage(index: ImageIndex, reference: string): string | null {
  const ref = reference.trim().replace(/\\/g, '/');
  if (ref === '') {
    return null;
  }
  const lower = ref.toLowerCase();
  const direct = index.get(lower);
  if (direct) {
    return direct;
  }
  for (const ext of IMAGE_EXTENSIONS) {
    const withExt = index.get(lower + ext);
    if (withExt) {
      return withExt;
    }
  }
  const base = lower.split('/').pop() ?? lower;
  const baseMatch = index.get(base);
  if (baseMatch) {
    return baseMatch;
  }
  for (const ext of IMAGE_EXTENSIONS) {
    const withExt = index.get(base + ext);
    if (withExt) {
      return withExt;
    }
  }
  // stable 的长按体/音符可以是动画序列（mania-note1L-0.png, -1, ...），静态预览取第 0 帧
  const frame0 = index.get(lower + '-0') ?? index.get(base + '-0');
  if (frame0) {
    return frame0;
  }
  return null;
}
