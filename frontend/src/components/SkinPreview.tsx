import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, Layers } from 'lucide-react';
import { api } from '../api/client';
import {
  DEFAULT_ASPECT,
  STABLE_SCALE,
  buildImageIndex,
  buildLayout,
  parseColor,
  resolveImage,
  rgba,
  squaredAlpha,
} from './maniaPreview';
import type { ImageIndex, PreviewColumn, PreviewLayout, Rgba } from './maniaPreview';
import { SkinHud } from './SkinHud';
import type { AccPlacement, HudSprites } from './SkinHud';

/** [Fonts] 小节里的字体前缀与字间距（stable 的 LegacySpriteText 依赖它们）。 */
export interface SkinFonts {
  scorePrefix: string;
  comboPrefix: string;
  scoreOverlap: number;
  comboOverlap: number;
}

interface SkinPreviewProps {
  skinPath: string;
  skinName: string;
  fonts: SkinFonts;
  keys: number | null;
  values: Record<string, string>;
  version?: string | null;
  width?: number | null;
}

interface Size {
  w: number;
  h: number;
}

const sizeCache = new Map<string, Size>();

/** osu! 对 @2x 贴图会自动折半显示尺寸。 */
function loadSize(url: string): Promise<void> {
  const cached = sizeCache.get(url);
  if (cached) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const image = new Image();
    const commit = () => {
      // api.imageUrl 会把 @ 编码成 %40，必须先解码再判断 @2x
      let decoded = url;
      try {
        decoded = decodeURIComponent(url);
      } catch {
        decoded = url;
      }
      const factor = /@2x/i.test(decoded) ? 2 : 1;
      sizeCache.set(url, {
        w: image.naturalWidth / factor,
        h: image.naturalHeight / factor,
      });
      resolve();
    };
    image.onload = commit;
    image.onerror = () => {
      sizeCache.set(url, { w: 0, h: 0 });
      resolve();
    };
    image.src = url;
  });
}

function sizeOf(url: string | null): Size | null {
  if (!url) {
    return null;
  }
  const size = sizeCache.get(url);
  return size && size.w > 0 ? size : null;
}

interface AlphaBand {
  /** 贴图高度比例，0 = 顶边，1 = 底边（含）。 */
  top: number;
  bottom: number;
}

const alphaCache = new Map<string, AlphaBand | null>();

/**
 * 扫描贴图的「不透明竖带」。预览靠它把面身两端的抗锯齿边缘藏到头/尾贴图的不透明部分下面：
 * 两段边都在同一行淡出时，两条抗锯齿边各自与底色混合，白底上会留下一条灰线（用户 m02810 反馈的
 * 「面尾出现了分割线」）。整张全透明的贴图得到 null（例：R Skin 缩投的 mania-noteBlank.png），
 * 这时没有东西能遮住面身，就让面身正好停在 Origin Bottom 位置。
 */
function loadAlpha(url: string): Promise<void> {
  if (alphaCache.has(url)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const image = new Image();
    const commit = () => {
      let band: AlphaBand | null = null;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.width > 0 && canvas.height > 0
          ? canvas.getContext('2d', { willReadFrequently: true })
          : null;
        if (context) {
          context.drawImage(image, 0, 0);
          const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let first = -1;
          let last = -1;
          for (let y = 0; y < canvas.height; y += 1) {
            let opaque = false;
            for (let x = 0; x < canvas.width; x += 1) {
              if (data[(y * canvas.width + x) * 4 + 3] >= 16) {
                opaque = true;
                break;
              }
            }
            if (opaque) {
              if (first < 0) {
                first = y;
              }
              last = y;
            }
          }
          if (first >= 0) {
            band = { top: first / canvas.height, bottom: (last + 1) / canvas.height };
          }
        }
      } catch {
        band = null;
      }
      alphaCache.set(url, band);
      resolve();
    };
    image.onload = commit;
    image.onerror = () => {
      alphaCache.set(url, null);
      resolve();
    };
    image.src = url;
  });
}

/** null = 整张贴图全透明；undefined = 还没扫描完（先按「整张不透明」处理）。 */
function alphaBandOf(url: string | null): AlphaBand | null | undefined {
  if (!url) {
    return null;
  }
  return alphaCache.get(url);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function aspectOf(url: string | null, fallback: number): number {
  const size = sizeOf(url);
  return size ? size.h / size.w : fallback;
}

/** 768 空间的原生像素 -> 480 空间。 */
function units(px: number): number {
  return px / STABLE_SCALE;
}

interface ColumnSprites {
  note: string | null;
  head: string | null;
  body: string | null;
  tail: string | null;
  key: string | null;
  keyDown: string | null;
}

const NOTE_FALLBACK_ASPECT = 0.5;
const KEY_FALLBACK_HEIGHT = 107;
/**
 * 预览专用：每张 note / 面条头 / 面条尾贴图左右各外扩这么多 480 空间单位。
 * 相邻轨道的贴图共边时，两张 <image> 的抗锯齿边缘各自和底色混合，共边处会留下一条 1 设备像素的
 * 竖线（用户 m02597 反馈的「note 之间分割线」；相邻贴图相同或不同都会出现，稳定版用整数像素定位所以没有）。
 * 左右各外扩之后，后画的贴图会盖住共边像素，缝就消失了；代价是每侧最多多出约 0.75 设备像素，肉眼不可见。
 * wiki（Skinning/osu!mania）没有相关描述，属于预览的自行决定。
 */
const NOTE_OVERLAP = 0.5;

type CentreMode = 'auto' | 'on' | 'off';
type Backdrop = 'white' | 'whiteRaw' | 'dark' | 'checker';

const ASPECTS: Array<{ id: string; label: string; value: number }> = [
  { id: '16:9', label: '16:9', value: 16 / 9 },
  { id: '16:10', label: '16:10', value: 1.6 },
  { id: '4:3', label: '4:3', value: 4 / 3 },
  { id: '21:9', label: '21:9', value: 21 / 9 },
];

function tint(color: Rgba, alpha: number): Rgba {
  return { ...color, a: alpha };
}

/**
 * osu! 惯例：skin.ini 里把某个元素写成 `_blank`（指向 `_blank.png`，一张全透明贴图）
 * 就等于「禁用该元素」。例：Jakads箭头 4K 段写 StageHint/StageLight/LightingN/LightingL: _blank。
 * 预览里用 1x1 透明贴图代替：元素照常占位（尺寸≈0），但既不显示、也不会掉进「缺贴图」的颜色兜底。
 */
const BLANK_URL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function isBlankRef(reference: string): boolean {
  const value = reference.trim().toLowerCase();
  return value === '_blank' || value === '_blank.png';
}

function firstUrl(
  index: ImageIndex,
  skinPath: string,
  candidates: Array<string | undefined>,
): string | null {
  for (const candidate of candidates) {
    const reference = candidate?.trim();
    if (!reference) {
      continue;
    }
    if (isBlankRef(reference)) {
      // 皮肤自带 _blank.png 时按实际文件走（多数皮肤就是 1x1 全透明）；没有才用内置透明贴图兜底
      const blankFile = resolveImage(index, reference);
      return blankFile ? api.imageUrl(skinPath, blankFile) : BLANK_URL;
    }
    const relative = resolveImage(index, reference);
    if (relative) {
      return api.imageUrl(skinPath, relative);
    }
  }
  return null;
}

export function SkinPreview({ skinPath, skinName, fonts, keys, values, version, width }: SkinPreviewProps) {
  const [imageIndex, setImageIndex] = useState<ImageIndex>(() => new Map());
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const [sizeTick, setSizeTick] = useState(0);
  const [showKeys, setShowKeys] = useState(true);
  const [showLights, setShowLights] = useState(true);
  const [centreMode, setCentreMode] = useState<CentreMode>('auto');
  const [backdrop, setBackdrop] = useState<Backdrop>('white');
  const [aspectId, setAspectId] = useState('16:10');
  const [viewMode, setViewMode] = useState<'compact' | 'screen'>('screen');
  // stable 的准确率在右上角（分数下方），不是轨道顶部居中
  const [accPlacement, setAccPlacement] = useState<AccPlacement>('top-right');
  const [useAt2x, setUseAt2x] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setImagesLoaded(false);
    api
      .images(skinPath)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setImageIndex(buildImageIndex(result.images, useAt2x));
        setImagesLoaded(true);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setImageIndex(new Map());
        setImagesLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [skinPath, useAt2x]);

  const activeKeys = keys ?? 0;
  const aspect = ASPECTS.find((item) => item.id === aspectId)?.value ?? DEFAULT_ASPECT;

  const explicitStart = (values.ColumnStart ?? '').trim() !== '';
  const centre = centreMode === 'auto' ? !explicitStart : centreMode === 'on';

  const layout: PreviewLayout | null = useMemo(() => {
    if (activeKeys <= 0) {
      return null;
    }
    return buildLayout({
      keys: activeKeys,
      value: (name) => values[name] ?? '',
      centre,
      aspect,
    });
  }, [activeKeys, aspect, centre, values]);

  const columnSprites = useMemo(() => {
    if (!layout) {
      return [] as ColumnSprites[];
    }
    return layout.columns.map((column) => {
      const token = column.token;
      const suffix = String(column.index);
      return {
        note: firstUrl(imageIndex, skinPath, [
          values[`NoteImage${suffix}`],
          `mania-note${token}`,
        ]),
        // 一律先读 skin.ini 显式值，缺省才用 wiki 规定的默认文件名；
        // 不做 wiki 未规定的跨元素回退（wiki 只写了「T 缺省时转而使用音符头元素」）。
        head: firstUrl(imageIndex, skinPath, [
          values[`NoteImage${suffix}H`],
          `mania-note${token}H`,
        ]),
        body: firstUrl(imageIndex, skinPath, [
          values[`NoteImage${suffix}L`],
          `mania-note${token}L`,
        ]),
        tail: firstUrl(imageIndex, skinPath, [
          values[`NoteImage${suffix}T`],
          `mania-note${token}T`,
          values[`NoteImage${suffix}H`],
          `mania-note${token}H`,
        ]),
        key: firstUrl(imageIndex, skinPath, [
          values[`KeyImage${suffix}`],
          `mania-key${token}`,
        ]),
        keyDown: firstUrl(imageIndex, skinPath, [
          values[`KeyImage${suffix}D`],
          `mania-key${token}D`,
        ]),
      };
    });
  }, [imageIndex, layout, skinPath, values]);

  // skin.ini 的舞台元素名（wiki/Skinning/skin.ini：StageLeft/StageRight/StageBottom/StageHint/StageLight）
  // 优先于默认文件名；写成 _blank 表示禁用（见 firstUrl）。
  const stageSprites = useMemo(() => {
    return {
      left: firstUrl(imageIndex, skinPath, [values.StageLeft, 'mania-stage-left']),
      right: firstUrl(imageIndex, skinPath, [values.StageRight, 'mania-stage-right']),
      bottom: firstUrl(imageIndex, skinPath, [values.StageBottom, 'mania-stage-bottom']),
      hint: firstUrl(imageIndex, skinPath, [values.StageHint, 'mania-stage-hint']),
      light: firstUrl(imageIndex, skinPath, [values.StageLight, 'mania-stage-light']),
    };
  }, [imageIndex, skinPath, values]);

  const hudSprites = useMemo<HudSprites>(() => {
    const digits = (prefix: string): Array<string | null> => {
      const out: Array<string | null> = [];
      for (let d = 0; d < 10; d++) {
        out.push(firstUrl(imageIndex, skinPath, [prefix + '-' + d]));
      }
      return out;
    };
    const complete = (list: Array<string | null>) => list.every((url) => url !== null);
    const scoreDigits = digits(fonts.scorePrefix);
    const comboDirect = digits(fonts.comboPrefix);
    const scoreOk = complete(scoreDigits);
    // stable 的默认 [Fonts] 里 ComboPrefix 就是 score：combo 图缺失时回退到 score 字体
    const comboDigits = complete(comboDirect) ? comboDirect : scoreOk ? scoreDigits : null;
    return {
      scoreDigits: scoreOk ? scoreDigits : null,
      comboDigits,
      scoreOverlap: fonts.scoreOverlap / 1.6,
      comboOverlap: fonts.comboOverlap / 1.6,
      // 默认用普通 300，便于调试（300g 贴在部分皮肤里尺寸异常）
      judgement: firstUrl(imageIndex, skinPath, ['mania-hit300', 'hit300', 'mania-hit300g']),
      // stable 的 getLookupName：逗号/句点/百分号也走 score 字体
      scoreExtra: {
        ',': firstUrl(imageIndex, skinPath, [fonts.scorePrefix + '-comma']),
        '.': firstUrl(imageIndex, skinPath, [fonts.scorePrefix + '-dot']),
        '%': firstUrl(imageIndex, skinPath, [fonts.scorePrefix + '-percent']),
      } as Record<string, string | null>,
      scorebarBg: firstUrl(imageIndex, skinPath, ['scorebar-bg']),
      scorebarColour: firstUrl(imageIndex, skinPath, ['scorebar-colour']),
    };
  }, [fonts, imageIndex, skinPath]);

  const urlKey = useMemo(() => {
    const all: string[] = [];
    const push = (url: string | null) => {
      if (url && !all.includes(url)) {
        all.push(url);
      }
    };
    for (const sprite of columnSprites) {
      push(sprite.note);
      push(sprite.head);
      push(sprite.body);
      push(sprite.tail);
      push(sprite.key);
      push(sprite.keyDown);
    }
    for (const url of Object.values(stageSprites)) {
      push(url);
    }
    push(hudSprites.judgement);
    push(hudSprites.scorebarBg);
    push(hudSprites.scorebarColour);
    for (const url of hudSprites.scoreDigits ?? []) {
      push(url);
    }
    for (const url of hudSprites.comboDigits ?? []) {
      push(url);
    }
    // 准确率的逗号/句点/百分号字形：漏掉它们会让 sizeOf 读到 null，
    // renderNumber 只能按 box.height * 0.5 兜底宽度 —— 百分号被压扁就是这么来的。
    for (const url of Object.values(hudSprites.scoreExtra)) {
      push(url);
    }
    return all.join('|');
  }, [columnSprites, hudSprites, stageSprites]);

  /** 需要扫描「不透明竖带」的贴图：只有面条头/尾（面身两端靠它们遮住，见 loadAlpha）。 */
  const alphaUrls = useMemo(() => {
    const all: string[] = [];
    for (const sprite of columnSprites) {
      if (sprite.head && !all.includes(sprite.head)) {
        all.push(sprite.head);
      }
      if (sprite.tail && !all.includes(sprite.tail)) {
        all.push(sprite.tail);
      }
    }
    return all;
  }, [columnSprites]);

  useEffect(() => {
    if (urlKey === '') {
      return;
    }
    let cancelled = false;
    const urls = urlKey.split('|');
    void Promise.all([...urls.map(loadSize), ...alphaUrls.map(loadAlpha)]).then(() => {
      if (!cancelled) {
        setSizeTick((tick) => tick + 1);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [urlKey, alphaUrls]);


  const model = useMemo(() => {
    if (!layout) {
      return null;
    }
    const versionText = String(version ?? '').trim().toLowerCase();
    const parsedVersion = versionText === 'latest' ? 99 : Number.parseFloat(versionText);
    // 本编辑器默认按「最新版」皮肤处理：未写 Version 时按 >= 2.5 处理，面尾照常取反
    const versionNumber = Number.isFinite(parsedVersion) ? parsedVersion : 99;

    const noteHeight = (url: string | null): number =>
      Math.max(2, layout.noteHeightScale * aspectOf(url, NOTE_FALLBACK_ASPECT));

    const notes: Array<{
      column: PreviewColumn;
      bottom: number;
      height: number;
      url: string | null;
      /** true = 底边落在某条轨道面条的结束位置上，渲染时排在面条之后，免得被面尾贴图盖住。 */
      align: boolean;
    }> = [];
    /** 每列面条结束位置（官方结束位置 = 面尾贴图画布下边，见下面 holdTop 的说明）所在的共享行（各列共用同一组行，跨轨道才可能严格对齐）。 */
    const laneHoldEnds: number[] = [];
    /** 演示单键之间、以及共享行之间至少留的空隙（≈ 一个 note 的高度）。 */
    const NOTE_GAP = 24;
    /** 判定线正上方那一行：演示单键可以一直贴到判定线。 */
    const hitRow = Math.max(80, layout.hitPosition - 8);
    const holds: Array<{
      column: PreviewColumn;
      bottom: number;
      top: number;
      headUrl: string | null;
      bodyUrl: string | null;
      tailUrl: string | null;
      headHeight: number;
      tailHeight: number;
      flipTail: boolean;
      /** 面身上边在面尾贴图画布内的位置（0 = 画布顶边，1 = 画布底边）；1 = 面身正好从结束位置开始。 */
      bodyTopFraction: number;
      /** 面身下边在面头贴图画布内的位置（0 = 画布顶边，1 = 画布底边）；1 = 面身正好铺到开始位置。 */
      bodyBottomFraction: number;
      bodyHeight: number;
      imageWidth: number;
      imageHeight: number;
      clipId: string;
    }> = [];

    // 演示谱面用一组共享行：所有单键的底边、面条的结束位置、面条头都取这些行，
    // 于是不同轨道的普通 note、面条起始 note、面条结尾一定落在同一条水平线上，不会错开几个像素。
    const maxNoteHeight = Math.max(
      2,
      ...layout.columns.map((_column, index) => noteHeight(columnSprites[index]?.note ?? null)),
    );
    const topEdge = maxNoteHeight + NOTE_GAP + 8;
    const rowStep = Math.max(maxNoteHeight + NOTE_GAP, (hitRow - topEdge) / 6);
    const demoRows: number[] = [];
    for (let rowIndex = 0; rowIndex < 6; rowIndex += 1) {
      demoRows.push(hitRow - rowStep * (rowIndex + 1));
    }
    demoRows.reverse(); // 从上到下
    const rowAt = (index: number): number =>
      demoRows[Math.max(0, Math.min(index, demoRows.length - 1))];

    layout.columns.forEach((column, index) => {
      const sprite = columnSprites[index];

      // 每列都有面条，方便同时调试头/尾：偶数列放在下半区（结束位置在第 4 行）、
      // 奇数列放在上半区（结束位置在第 1 行）。相邻轨道的空白区正好能放一个单键贴住那条线。
      const upperHalf = index % 2 === 1;
      const endRow = upperHalf ? rowAt(0) : rowAt(3);
      const headRow = upperHalf ? rowAt(2) : hitRow;
      const bodyUrl = sprite?.body ?? null;
      const bodySize = sizeOf(bodyUrl);
      const tailUrl = sprite?.tail ?? null;
      const headUrl = sprite?.head ?? null;
      // wiki：皮肤版本 >= 2.5 时音符尾默认上下翻转，可用 NoteFlipWhenUpsideDownT=0 关闭
      const flipTail =
        versionNumber >= 2.5 &&
        (values[`NoteFlipWhenUpsideDown${index}T`] ?? values.NoteFlipWhenUpsideDown ?? '1') !== '0';
      // 面身（L）也是 Origin Bottom：官方位置就是下边 = 开始位置（面头下边）、上边 = 结束位置（面尾下边）。
      // 但两段在官方位置各自淡出半条抗锯齿边时会和白底混出一条灰线（用户 m02810 的「面尾分割线」），
      // 所以预览把面身两端各往头/尾贴图的「不透明竖带」里塞一点：不透明处能把面身边缘完全盖住，
      // 贴图整张透明时（例：R Skin v2.0 的 NoteImage*H 指向 1000x1 全透明的 mania-note1H.png、
      // R Skin 缩投的 mania-noteBlank.png）没有东西可遮，就退回官方位置本身 ——
      // 于是「面条可见底边」恒等于开始位置，与同排普通 note 的底边严格对齐
      // （用户 m02597 反馈的「面条头底部渲染起始点比正常 note 偏上」就是原先取 hold.bottom - headHeight/2
      //   造成的：头贴图透明时可见底边就比 note 高半个头贴图高度）。
      // wiki（Skinning/osu!mania）只说 H/L/T 的 Origin 都是 Bottom，没有规定面身怎么和头/尾拼接，
      // 这里按上面的规则处理，属于预览的自行决定。
      const tailHeight = noteHeight(tailUrl);
      const headHeight = noteHeight(headUrl);
      // 面尾贴图画布下边 = 结束位置（对齐用的单键底边也压在这条线上）。依据 wiki：面尾 T 的 Origin
      // 是 Bottom ⇒ 画布 = [结束位置 - T, 结束位置]。刻意不用贴图的「可见边缘」当基准 —— 像 R Skin (UE)
      // 的 mania-note1T.png 是一整块不透明纯黑，它盖住面身上半段是贴图本身的效果，不是结束位置偏移。
      const holdTop = Math.max(0, endRow - tailHeight);
      // 面身两端落在头/尾贴图「不透明竖带」的中心：这样面身自己的抗锯齿边被不透明像素盖住，
      // 交界处只剩头/尾贴图的一条边，不会两条边叠出灰线。整张贴图透明 = 没有东西可遮，就用官方
      // Origin Bottom 位置：面尾贴图下边 = 结束位置（fraction 1）、面头贴图下边 = 开始位置（fraction 1）。
      // flipTail 时面尾贴图上下翻转，竖带位置也要翻过来。
      const tailBand = alphaBandOf(tailUrl);
      const headBand = alphaBandOf(headUrl);
      const tailCentre: number =
        tailBand === null
          ? 1
          : tailBand === undefined
            ? 0.5
            : clamp01(flipTail ? 1 - (tailBand.top + tailBand.bottom) / 2 : (tailBand.top + tailBand.bottom) / 2);
      const headCentre: number =
        headBand === null
          ? 1
          : headBand === undefined
            ? 0.5
            : clamp01((headBand.top + headBand.bottom) / 2);

      holds.push({
        column,
        bottom: headRow,
        top: holdTop,
        headUrl,
        bodyUrl,
        tailUrl,
        headHeight,
        tailHeight,
        flipTail,
        bodyTopFraction: tailCentre,
        bodyBottomFraction: headCentre,
        bodyHeight: Math.max(1, column.width * aspectOf(bodyUrl, 1)),
        imageWidth: bodySize ? bodySize.w : column.width,
        imageHeight: bodySize ? bodySize.h : 1,
        clipId: `pv-body-clip-${index}`,
      });
      laneHoldEnds[index] = endRow;
    });

    // 演示单键：底边全部落在共享行上（于是不同轨道的 note 一定对齐）。偶数列放在面条上方、
    // 奇数列放在面条下方；每列还会多补一个「上一轨道面条结束位置」那一行的单键 —— 它的底边
    // 正好压在面条结束的那条线上，两列并排即可比对面条末端与 note 开始位置的边缘。
    // 三道闸：不许超出画面/判定线、不许吃进本列面条区间、与本列已有单键至少隔开 NOTE_GAP。
    layout.columns.forEach((column, index) => {
      const sprite = columnSprites[index];
      const url = sprite?.note ?? null;
      const height = noteHeight(url);
      const holdEnd = laneHoldEnds[index];
      const holdBottom = holds[index].bottom;
      const upperHalf = index % 2 === 1;
      const previousIndex = (index - 1 + layout.columns.length) % layout.columns.length;
      const wanted = upperHalf ? [rowAt(3), rowAt(5), hitRow] : [rowAt(0), rowAt(2)];
      wanted.push(laneHoldEnds[previousIndex]);
      const placed: number[] = [];
      for (const bottom of wanted.slice().sort((a, b) => b - a)) {
        if (bottom - height < 24) {
          continue; // 顶出画面
        }
        if (bottom > hitRow + 0.5) {
          continue; // 低过判定线，会压住按键
        }
        const clearAbove = bottom <= holdEnd - NOTE_GAP;
        const clearBelow = bottom - height >= holdBottom + NOTE_GAP;
        if (!clearAbove && !clearBelow) {
          continue; // 与本列面条重叠
        }
        if (placed.some((other) => Math.abs(other - bottom) < height + NOTE_GAP)) {
          continue; // 与本列已有单键挤在一起（含重复的共享行）
        }
        placed.push(bottom);
        notes.push({
          column,
          bottom,
          height,
          url,
          align: laneHoldEnds.some((end) => Math.abs(end - bottom) < 0.5),
        });
      }
    });

    const barlineYs: number[] = [];
    for (let y = 80; y < layout.hitPosition - 4; y += 150) {
      barlineYs.push(y);
    }

    const total = Math.max(1, columnSprites.length * 6);
    const resolved = columnSprites.reduce(
      (count, sprite) =>
        count +
        [sprite.note, sprite.head, sprite.body, sprite.tail, sprite.key, sprite.keyDown].filter(
          (url) => url !== null,
        ).length,
      0,
    );
    return { notes, holds, barlineYs, resolved, total };
    // sizeTick：贴图尺寸是异步读到的，尺寸到位后必须重算面身/note 尺寸
  }, [columnSprites, layout, sizeTick, values, version]);

  if (!layout || !model) {
    return (
      <aside className="preview-pane" style={width ? { flex: `0 0 ${width}px` } : undefined}>
        <div className="preview-head">
          <Layers size={14} />
          <h3>皮肤预览</h3>
        </div>
        <div className="preview-empty">
          {imagesLoaded ? '选择一个键数模块后显示预览' : '正在读取皮肤贴图…'}
        </div>
      </aside>
    );
  }

  const columnLineColor = squaredAlpha(parseColor(values.ColourColumnLine, { r: 255, g: 255, b: 255, a: 1 }));
  const barlineColor = parseColor(values.ColourBarline, { r: 255, g: 255, b: 255, a: 1 });
  const judgementColor = parseColor(values.ColourJudgementLine, { r: 255, g: 255, b: 255, a: 1 });
  const stageWidth = Math.max(1, layout.stageRight - layout.stageLeft);
  const stageCentre = (layout.stageLeft + layout.stageRight) / 2;
  const pressedColumn = layout.columns.length > 0 ? 0 : -1;
  const keysUnderNotes = (values.KeysUnderNotes ?? '').trim() === '1';
  const showJudgementLine = (values.JudgementLine ?? '').trim() === '1';
  // 相邻轨道背景色相同时合并成一张 rect：一轨一张的话，两张 rect 的抗锯齿边缘在共边处各
  // 覆盖一部分，底色从缝里透出来就是一条 1 设备像素的浅色细线（界面缩放不同时边界的亚像素
  // 位置不同，所以有的轨道边界看得见、有的看不见）。
  const backgroundRuns: Array<{ x: number; width: number; fill: Rgba }> = [];
  for (const column of layout.columns) {
    const fill = squaredAlpha(column.background);
    const last = backgroundRuns[backgroundRuns.length - 1];
    if (
      last &&
      Math.abs(last.x + last.width - column.x) < 1e-6 &&
      last.fill.r === fill.r &&
      last.fill.g === fill.g &&
      last.fill.b === fill.b &&
      last.fill.a === fill.a
    ) {
      last.width = column.x + column.width - last.x;
    } else {
      backgroundRuns.push({ x: column.x, width: column.width, fill });
    }
  }

  const hintSize = sizeOf(stageSprites.hint);
  const hintHeight = hintSize ? units(hintSize.h) * 1.44225 : 0;
  const bottomSize = sizeOf(stageSprites.bottom);
  const leftSize = sizeOf(stageSprites.left);
  const rightSize = sizeOf(stageSprites.right);
  const lightSize = sizeOf(stageSprites.light);
  // stable 里这些舞台贴图只做纵向拉伸，宽度取贴图原始宽度（768 空间像素 -> 480 空间）
  const leftWidth = leftSize ? units(leftSize.w) : 0;
  const rightWidth = rightSize ? units(rightSize.w) : 0;

  // 紧凑视野：把画面裁到舞台（含左右边框贴图）范围，让预览尽可能大。
  const compact = viewMode === 'compact';
  const decorLeft = stageSprites.left && leftSize ? units(leftSize.w) : 0;
  const decorRight = stageSprites.right && rightSize ? units(rightSize.w) : 0;
  const viewX = compact ? Math.min(0, layout.stageLeft - decorLeft - 8) : 0;
  const viewWidth = compact
    ? Math.max(40, layout.stageRight + decorRight + 8 - viewX)
    : layout.width;
  const backdropFill =
    backdrop === 'checker' ? 'url(#pv-checker)' : backdrop === 'dark' ? '#101317' : '#ffffff';
  const backdropDim = backdrop === 'white' ? 0.72 : 0;

  const renderNotes = () => (
    <>
      {model.notes.map((note, index) =>
        note.align ? null : note.url ? (
          <image
            key={`note-${index}`}
            href={note.url}
            x={note.column.x - NOTE_OVERLAP}
            y={note.bottom - note.height}
            width={note.column.width + NOTE_OVERLAP * 2}
            height={note.height}
            preserveAspectRatio="none"
          />
        ) : (
          <rect
            key={`note-${index}`}
            x={note.column.x - NOTE_OVERLAP}
            y={note.bottom - note.height}
            width={note.column.width + NOTE_OVERLAP * 2}
            height={note.height}
            rx="1.5"
            fill={rgba(tint(note.column.light, 0.8))}
          />
        ),
      )}
      {model.holds.map((hold, index) => {
          // 面身两端各往头/尾贴图里塞一点（见上面 holds 构建处 bodyTopFraction/bodyBottomFraction 的说明）：
          // 头/尾贴图不透明处完全盖住面身边缘（交界处不留灰线），贴图透明处面身照旧露到官方位置。
          const bodyTop = hold.top + hold.tailHeight * hold.bodyTopFraction;
          const bodyBottom = hold.bottom - hold.headHeight * (1 - hold.bodyBottomFraction);
          const tailY = hold.top;
          const length = Math.max(0, bodyBottom - bodyTop);
          return (
            <g key={`hold-${index}`}>
              <g clipPath={`url(#${hold.clipId})`}>
                {hold.bodyUrl && length > 0 ? (
                  hold.bodyHeight >= length ? (
                    // 贴图比面条长：用嵌套 svg 只裁剪显示最上方一小段
                    <svg
                      x={hold.column.x}
                      y={bodyTop}
                      width={hold.column.width}
                      height={length}
                      viewBox={'0 0 ' +
                        hold.imageWidth +
                        ' ' +
                        (hold.imageHeight * (length / hold.bodyHeight)) +
                        ' '}
                      preserveAspectRatio="none"
                    >
                      <image
                        href={hold.bodyUrl}
                        x={0}
                        y={0}
                        width={hold.imageWidth}
                        height={hold.imageHeight}
                        preserveAspectRatio="none"
                      />
                    </svg>
                  ) : (
                    // 贴图比面条短：整张拉伸铺满面条身（不再逐块平铺，避免拼接痕迹）
                    <image
                      href={hold.bodyUrl}
                      x={hold.column.x}
                      y={bodyTop}
                      width={hold.column.width}
                      height={length}
                      preserveAspectRatio="none"
                    />
                  )
                ) : (
                  <rect
                    x={hold.column.x}
                    y={bodyTop}
                    width={hold.column.width}
                    height={length}
                    fill={rgba(tint(hold.column.light, 0.5))}
                  />
                )}
              </g>
              {hold.headUrl ? (
                <image
                  href={hold.headUrl}
                  x={hold.column.x - NOTE_OVERLAP}
                  y={hold.bottom - hold.headHeight}
                  width={hold.column.width + NOTE_OVERLAP * 2}
                  height={hold.headHeight}
                  preserveAspectRatio="none"
                />
              ) : (
                <rect
                  x={hold.column.x - NOTE_OVERLAP}
                  y={hold.bottom - hold.headHeight}
                  width={hold.column.width + NOTE_OVERLAP * 2}
                  height={hold.headHeight}
                  rx="1.5"
                  fill={rgba(tint(hold.column.light, 0.9))}
                />
              )}
              {hold.tailUrl ? (
                <g transform={hold.flipTail ? `matrix(1 0 0 -1 0 ${hold.top * 2 + hold.tailHeight})` : undefined}>
                  <image
                    href={hold.tailUrl}
                    x={hold.column.x - NOTE_OVERLAP}
                    y={tailY}
                    width={hold.column.width + NOTE_OVERLAP * 2}
                    height={hold.tailHeight}
                    preserveAspectRatio="none"
                  />
                </g>
              ) : (
                <rect
                  x={hold.column.x - NOTE_OVERLAP}
                  y={tailY}
                  width={hold.column.width + NOTE_OVERLAP * 2}
                  height={hold.tailHeight}
                  rx="1.5"
                  fill={rgba(tint(hold.column.light, 0.9))}
                />
              )}
            </g>
          );
        })}
      {model.notes.map((note, index) =>
        note.align && note.url ? (
          <image
            key={`note-${index}`}
            href={note.url}
            x={note.column.x - NOTE_OVERLAP}
            y={note.bottom - note.height}
            width={note.column.width + NOTE_OVERLAP * 2}
            height={note.height}
            preserveAspectRatio="none"
          />
        ) : null,
      )}
    </>
  );

  // wiki（Skinning/osu!mania）mania-key：定位点=底部、推荐标准大小 50x107、
  //「为了适合列宽，会拉伸或压缩此元素」——即横向拉伸到列宽、纵向不缩放。
  // mania 舞台/按键贴图以 768 高的游玩区域为基准 1:1（默认遗留皮肤 mania-stage-left = 7x768、mania-key1 = 50x107），
  // 折算到 480 空间要 /1.6，因此高度取贴图自身像素高 /1.6，贴图底边贴游玩区底边。
  const renderKeys = () => (
    <g>
      {layout.columns.map((column) => {
        const sprite = columnSprites[column.index];
        const pressed = column.index === pressedColumn;
        const url = pressed ? sprite?.keyDown ?? sprite?.key ?? null : sprite?.key ?? null;
        const size = sizeOf(url);
        const height = size ? units(size.h) : units(KEY_FALLBACK_HEIGHT);
        const y = layout.height - height;
        if (url && size) {
          return (
            <image
              key={`key-${column.index}`}
              href={url}
              x={column.x - NOTE_OVERLAP}
              y={y}
              width={column.width + NOTE_OVERLAP * 2}
              height={height}
              preserveAspectRatio="none"
            />
          );
        }
        return (
          <g key={`key-${column.index}`}>
            <rect
              x={column.x}
              y={y}
              width={column.width}
              height={height}
              fill={rgba(tint(squaredAlpha(column.background), Math.max(0.5, column.background.a)))}
              stroke={rgba(tint(column.light, pressed ? 0.9 : 0.3))}
              strokeWidth="0.8"
            />
            <rect
              x={column.x}
              y={y}
              width={column.width}
              height={height}
              fill={rgba(tint(column.light, pressed ? 0.35 : 0.1))}
            />
          </g>
        );
      })}
    </g>
  );

  return (
    <aside className="preview-pane" style={width ? { flex: `0 0 ${width}px` } : undefined}>
      <div className="preview-head">
        <Layers size={14} />
        <h3>皮肤预览</h3>
        <span className="preview-chip">{layout.keys}K</span>
        <span className="preview-chip preview-chip-name" title={skinName}>
          {skinName}
        </span>
        {version && <span className="preview-chip">v{version}</span>}
      </div>

      <div className="preview-toolbar">
        <button
          type="button"
          className={showKeys ? 'active' : ''}
          onClick={() => setShowKeys((current) => !current)}
          title="显示/隐藏挡板按键"
        >
          {showKeys ? <Eye size={13} /> : <EyeOff size={13} />}
          挡板
        </button>

        <button
          type="button"
          className={showLights ? 'active' : ''}
          onClick={() => setShowLights((current) => !current)}
          title="显示/隐藏列灯光与判定线"
        >
          {showLights ? <Eye size={13} /> : <EyeOff size={13} />}
          灯光
        </button>
        <label className="preview-field">
          视野
          <select value={viewMode} onChange={(event) => setViewMode(event.target.value as 'compact' | 'screen')}>
            <option value="compact">贴合舞台</option>
            <option value="screen">整屏</option>
          </select>
        </label>
        <label className="preview-field">
          水平
          <select value={centreMode} onChange={(event) => setCentreMode(event.target.value as CentreMode)}>
            <option value="auto">自动</option>
            <option value="on">居中</option>
            <option value="off">按 ColumnStart</option>
          </select>
        </label>
        <label className="preview-field">
          比例
          <select value={aspectId} disabled={compact} onChange={(event) => setAspectId(event.target.value)}>
            {ASPECTS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className={useAt2x ? 'active' : ''}
          onClick={() => setUseAt2x((current) => !current)}
          title="使用 @2x 贴图（自动缩小一半）；关闭则只用 1x 贴图"
        >
          @2x
        </button>
        <label className="preview-field">
          acc
          <select value={accPlacement} onChange={(event) => setAccPlacement(event.target.value as AccPlacement)}>
            <option value="top-centre">顶部居中</option>
            <option value="top-right">右上角</option>
          </select>
        </label>
        <label className="preview-field">
          谱面bg
          <select value={backdrop} onChange={(event) => setBackdrop(event.target.value as Backdrop)}>
            <option value="white">纯白 + 暗化</option>
            <option value="whiteRaw">纯白（无暗化）</option>
            <option value="dark">深色</option>
            <option value="checker">棋盘</option>
          </select>
        </label>
      </div>

      <div className="preview-stage-wrap">
        <svg
          className="preview-stage"
          viewBox={`${viewX} 0 ${viewWidth} ${layout.height}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="osu!mania 皮肤预览"
        >
          <defs>
            <pattern id="pv-checker" width="16" height="16" patternUnits="userSpaceOnUse">
              <rect width="16" height="16" fill="#191d22" />
              <rect width="8" height="8" fill="#21272e" />
              <rect x="8" y="8" width="8" height="8" fill="#21272e" />
            </pattern>
            <clipPath id="pv-field-clip">
              <rect x={viewX} y="0" width={viewWidth} height={layout.height} />
            </clipPath>
            {model.holds.map((hold) => {
              // 面身只裁在轨道的水平范围内，纵向与实际绘制的面身范围一致
              // （这样面身两端能伸进头/尾贴图的不透明部分，由贴图盖住它的抗锯齿边）。
              const clipTop = hold.top + hold.tailHeight * hold.bodyTopFraction;
              const clipBottom = hold.bottom - hold.headHeight * (1 - hold.bodyBottomFraction);
              return (
                <clipPath key={hold.clipId} id={hold.clipId}>
                  <rect
                    x={hold.column.x}
                    y={clipTop}
                    width={hold.column.width}
                    height={Math.max(0, clipBottom - clipTop)}
                  />
                </clipPath>
              );
            })}
          </defs>

          <g clipPath="url(#pv-field-clip)">
            <rect x={viewX} y="0" width={viewWidth} height={layout.height} fill={backdropFill} />
            {backdropDim > 0 && (
              <rect
                x={viewX}
                y="0"
                width={viewWidth}
                height={layout.height}
                fill={'rgba(0, 0, 0, ' + backdropDim + ')'}
              />
            )}

            {stageSprites.left && leftSize && (
              <image
                href={stageSprites.left}
                x={layout.stageLeft - leftWidth}
                y="0"
                width={leftWidth}
                height={layout.height}
                preserveAspectRatio="none"
              />
            )}
            {stageSprites.right && rightSize && (
              <image
                href={stageSprites.right}
                x={layout.stageRight}
                y="0"
                width={rightWidth}
                height={layout.height}
                preserveAspectRatio="none"
              />
            )}

            {backgroundRuns.map((run, index) => (
              <rect
                key={`bg-${index}`}
                x={run.x}
                y="0"
                width={run.width}
                height={layout.height}
                fill={rgba(run.fill)}
              />
            ))}

            {layout.columns.map((column) => (
              <g key={`lines-${column.index}`}>
                {column.leftLine > 0 && (
                  <rect
                    x={column.x}
                    y="0"
                    width={column.leftLine}
                    height={layout.hitPosition}
                    fill={rgba(columnLineColor)}
                  />
                )}
                {column.rightLine > 0 && (
                  <rect
                    x={column.x + column.width - column.rightLine}
                    y="0"
                    width={column.rightLine}
                    height={layout.hitPosition}
                    fill={rgba(columnLineColor)}
                  />
                )}
              </g>
            ))}

            {showLights && stageSprites.hint && hintHeight > 0 && (
              <image
                href={stageSprites.hint}
                x={layout.stageLeft}
                y={layout.hitPosition - hintHeight / 2}
                width={stageWidth}
                height={hintHeight}
                preserveAspectRatio="none"
              />
            )}
            {showLights && !stageSprites.hint && (
              <rect
                x={layout.stageLeft}
                y={layout.hitPosition - 0.75}
                width={stageWidth}
                height="1.5"
                fill={rgba(judgementColor)}
              />
            )}
            {showLights && showJudgementLine && (
              <rect
                x={layout.stageLeft}
                y={layout.hitPosition - 0.5}
                width={stageWidth}
                height="1"
                fill={rgba(judgementColor)}
                opacity="0.9"
              />
            )}

            {showLights &&
              layout.columns.map((column) => {
                const lightHeight = lightSize ? units(lightSize.h) : 6;
                const y = layout.lightPosition - lightHeight;
                if (y > layout.height || y + lightHeight < 0) {
                  return null;
                }
                return stageSprites.light && lightSize ? (
                  // wiki：mania-stage-light 使用相乘模式混合
                  <image
                    key={`light-${column.index}`}
                    href={stageSprites.light}
                    x={column.x}
                    y={y}
                    width={column.width}
                    height={lightHeight}
                    preserveAspectRatio="none"
                    style={{ mixBlendMode: 'multiply' }}
                  />
                ) : (
                  <rect
                    key={`light-${column.index}`}
                    x={column.x}
                    y={y}
                    width={column.width}
                    height={lightHeight}
                    fill={rgba(tint(column.light, 0.3))}
                  />
                );
              })}

            {model.barlineYs.map((y) => (
              <rect
                key={`bar-${y}`}
                x={layout.stageLeft}
                y={y}
                width={stageWidth}
                height={Math.max(0.4, layout.barlineHeight)}
                fill={rgba(barlineColor)}
              />
            ))}

            {keysUnderNotes && renderKeys()}
            {renderNotes()}
            {!keysUnderNotes && renderKeys()}

            {!compact && (
              <SkinHud
                width={layout.width}
                height={layout.height}
                stageLeft={layout.stageLeft}
                stageRight={layout.stageRight}
                comboPosition={layout.comboPosition}
                scorePosition={layout.scorePosition}
                sprites={hudSprites}
                sizeOf={sizeOf}
                accPlacement={accPlacement}
              />
            )}

            {stageSprites.bottom && bottomSize && (
              // wiki（Skinning/osu!mania）mania-stage-bottom：
              //「此元素不会为适应轨道区域宽度而被拉伸」「此元素应针对高度 480px 的游玩区域设计」
              // 定位点：底部。
              //「此元素比舞台宽度小 0.625 倍（即 768 空间舞台下的 480）」「此元素会覆盖整个舞台，包括音符」。
              // —— 因此按贴图自身尺寸（480 空间 1:1，含贴图自带透明边距）原样绘制，
              // 不按轨道宽度缩放、也不做 768->480 折算；底边贴游玩区底边、水平居中于轨道区域。
              <image
                href={stageSprites.bottom}
                x={stageCentre - bottomSize.w / 2}
                y={layout.height - bottomSize.h}
                width={bottomSize.w}
                height={bottomSize.h}
                preserveAspectRatio="none"
              />
            )}
          </g>
        </svg>
      </div>

      <div className="preview-legend">
        <div>
          水平：{layout.centred ? '自动居中' : `ColumnStart ${Math.round(layout.stageLeft)}`}
          ，判定线 {Math.round(layout.hitPosition)}/480，note 高度基准 {Math.round(layout.noteHeightScale)}
        </div>
        <div>
          贴图：note/面条/挡板 {model.resolved}/{model.total} 张
          {Object.values(stageSprites).filter((url) => url !== null).length > 0
            ? `，舞台 ${Object.values(stageSprites).filter((url) => url !== null).length} 张`
            : ''}
        </div>
        <div className="preview-tip">
          按 osu! 以 480 高度为基准的坐标换算；未在 skin.ini 指定的贴图会用 osu! 默认名
          （mania-note1/2/S、mania-key1/2/S、mania-stage-* 等）在皮肤目录中查找，找不到时以颜色示意。
        </div>
      </div>
    </aside>
  );
}
