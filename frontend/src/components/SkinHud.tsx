import type { ReactElement } from 'react';

export interface HudSize {
  w: number;
  h: number;
}

export interface HudSprites {
  scoreDigits: Array<string | null> | null;
  comboDigits: Array<string | null> | null;
  judgement: string | null;
  scorebarBg: string | null;
  scorebarColour: string | null;
  /** [Fonts] ScoreOverlap / ComboOverlap（768 空间像素） */
  scoreOverlap: number;
  comboOverlap: number;
  /** score 字体里的非数字字形（, . %），缺失即为 null */
  scoreExtra: Record<string, string | null>;
}

export type AccPlacement = 'top-right' | 'top-centre';

interface SkinHudProps {
  width: number;
  height: number;
  stageLeft: number;
  stageRight: number;
  comboPosition: number | null;
  scorePosition: number | null;
  sprites: HudSprites;
  sizeOf: (url: string | null) => HudSize | null;
  accPlacement: AccPlacement;
}

const SCORE_VALUE = '00208774';
// 预览里演示用的准确率：取 60% 而不是接近满圆的值，饼图的扇形和缺口都能看清（纯展示数据，长度与 94.66% 相同，不影响布局）
const ACCURACY = '60.00%';
const ACCURACY_RATIO = 0.6;
const COMBO_VALUE = '59';

/** stable 的 LegacyScoreCounter / LegacyAccuracyCounter 常量（768 空间，需 /1.6 换算到 480 空间）。 */
const SCORE_SCALE = 0.96;
const SCORE_MARGIN_H = 10;
const ACC_SCALE = 0.6 * 0.96;
const ACC_MARGIN_V = 9;
const ACC_MARGIN_H = 17;
const UNITS_PER_PIXEL = 1 / 1.6;
/** 官方默认值（480 空间）：lazer LegacyManiaSkinConfiguration 的 ScorePosition / ComboPosition。 */
const DEFAULT_SCORE_POSITION = 300;
const DEFAULT_COMBO_POSITION = 111;

/** stable 的排行榜每一条占两行：第一行名字、第二行分数 + 连击。 */

interface NumberBox {
  x: number;
  y: number;
  height: number;
  anchor: 'start' | 'middle' | 'end';
  advanceScale?: number;
  advanceOverlap?: number;
  extraGlyphs?: Record<string, string | null>;
  /** wiki：mania 下分数数字使用相乘模式混合 */
  blend?: 'multiply';
}

/** 排布好的字形：宽高都按同一个缩放比例取自贴图自然尺寸。 */
interface LaidGlyph {
  url: string;
  width: number;
  height: number;
  advance: number;
}

/**
 * stable 的 sprite font（LegacySpriteText）把每个字形按贴图自然尺寸塞进同一个 SpriteText，
 * 所以整段文本共用一个缩放比例：标点、百分号必须跟着同一比例，不能各自拉伸到 box.height，
 * 否则比数字高的标点会被压扁/比数字矮的会被拉长（Jakads箭头 score-percent 71x66 vs 数字 54 高）。
 * 缩放参考字形取 digits[0]（调用方用它的自然高推出 box.height）。
 * overlap = [Fonts] ScoreOverlap/ComboOverlap，是 768 空间的贴图像素，随 factor 一起缩放。
 */
function layoutGlyphs(
  digits: Array<string | null> | null,
  value: string,
  box: NumberBox,
  sizeOf: (url: string | null) => HudSize | null,
): Array<LaidGlyph> | null {
  if (!digits) {
    return null;
  }
  const reference = digits[0] ? sizeOf(digits[0]) : null;
  const factor = reference ? (box.height / reference.h) * (box.advanceScale ?? 1) : 1;
  const overlap = (box.advanceOverlap ?? 0) * factor;
  const glyphs: Array<LaidGlyph> = [];
  for (const ch of value.split('')) {
    const index = ch >= '0' && ch <= '9' ? ch.charCodeAt(0) - 48 : -1;
    const url = index >= 0 ? digits[index] : (box.extraGlyphs?.[ch] ?? null);
    if (!url) {
      // stable 的 sprite font：贴图缺失的字形整段跳过（皮肤没有 percent 图就不显示 %）
      continue;
    }
    const size = sizeOf(url);
    const width = size ? size.w * factor : box.height * 0.5;
    const height = size ? size.h * factor : box.height;
    glyphs.push({ url, width, height, advance: Math.max(1, width - overlap) });
  }
  return glyphs;
}

/** 整段文本的推进宽度，供贴着文字摆放的元素（acc 饼图）使用。 */
function measureNumber(
  digits: Array<string | null> | null,
  value: string,
  box: NumberBox,
  sizeOf: (url: string | null) => HudSize | null,
): number {
  const glyphs = layoutGlyphs(digits, value, box, sizeOf);
  if (!glyphs) {
    return value.length * box.height * 0.5;
  }
  return glyphs.reduce((sum, item) => sum + item.advance, 0);
}

function renderNumber(
  digits: Array<string | null> | null,
  value: string,
  box: NumberBox,
  sizeOf: (url: string | null) => HudSize | null,
  keyPrefix: string,
  className: string,
): ReactElement | Array<ReactElement> {
  const glyphs = layoutGlyphs(digits, value, box, sizeOf);
  if (!glyphs) {
    return (
      <text
        key={keyPrefix}
        className={className}
        x={box.x}
        y={box.y + box.height * 0.86}
        textAnchor={box.anchor}
        fontSize={box.height}
      >
        {value}
      </text>
    );
  }
  const total = glyphs.reduce((sum, item) => sum + item.advance, 0);
  let cursor =
    box.anchor === 'start' ? box.x : box.anchor === 'middle' ? box.x - total / 2 : box.x - total;
  return glyphs.map((item, i) => {
    const element = (
      <image
        key={keyPrefix + '-i' + i}
        href={item.url}
        x={cursor}
        y={box.y}
        width={item.width}
        height={item.height}
        preserveAspectRatio="none"
        style={box.blend ? { mixBlendMode: box.blend } : undefined}
      />
    );
    cursor += item.advance;
    return element;
  });
}

function naturalHeight(size: HudSize | null, fallback: number): number {
  return size ? size.h * UNITS_PER_PIXEL : fallback;
}

export function SkinHud(props: SkinHudProps): ReactElement {
  const {
    width,
    height,
    stageLeft,
    stageRight,
    comboPosition,
    scorePosition,
    sprites,
    sizeOf,
    accPlacement,
  } = props;

  const stageCentre = (stageLeft + stageRight) / 2;

  // 分数：TopRight，Scale 0.96，Margin.Horizontal 10（768 空间）
  const scoreSize = sizeOf(sprites.scoreDigits?.[0] ?? null);
  const scoreHeight = naturalHeight(scoreSize, height * 0.05) * SCORE_SCALE;
  const scoreMargin = SCORE_MARGIN_H * UNITS_PER_PIXEL;
  const scoreBox: NumberBox = {
    x: width - scoreMargin,
    y: scoreMargin,
    height: scoreHeight,
    anchor: 'end',
    advanceOverlap: sprites.scoreOverlap,
    extraGlyphs: sprites.scoreExtra,
  };

  // 准确率：stable 用 score 字体（LegacyAccuracyCounter = LegacySpriteText(Score)、Scale 0.576、Margin 17/9）
  const accHeight = scoreHeight * ACC_SCALE;
  // 饼图是 osu!stable 专有（lazer 的 LegacyAccuracyCounter 只有百分比文字，见 GameplayAccuracyCounter），
  // 因此尺寸/间距按「直径 = 文字高、与文字垂直居中、紧贴文字左侧」自行决定。
  const gaugeRadius = accHeight * 0.5;
  const accGap = accHeight * 0.3;
  const accY = scoreMargin + scoreMargin + scoreHeight + ACC_MARGIN_V * UNITS_PER_PIXEL;
  const accBox: NumberBox = {
    x: 0,
    y: accY - accHeight / 2,
    height: accHeight,
    anchor: 'end',
    advanceOverlap: sprites.scoreOverlap,
    extraGlyphs: sprites.scoreExtra,
  };
  // 用真实字形推进宽度（不是「字数 × 半高」估算），否则饼图会压到首个字形上
  const accTextWidth = measureNumber(sprites.scoreDigits, ACCURACY, accBox, sizeOf);


  // 连击：stable 的 LegacySpriteText(Combo)，字号 = 贴图原始高度，居中于 ComboPosition
  const comboSize = sizeOf(sprites.comboDigits?.[0] ?? null);
  const comboHeight = naturalHeight(comboSize, height * 0.06);
  // 连击中心在 ComboPosition（官方 ManiaLegacySkinTransformer：Anchor=TopCentre、Origin=Centre），
  // 未设置时用官方默认 111；高度取字形自然高（官方整个组件没有任何 Scale）。
  // 稳定版加分瞬间还有 onCountIncrement 的 1.4 倍竖直瞬态（300ms 回弹），预览只画静止态。
  const comboCentre = comboPosition !== null ? comboPosition : DEFAULT_COMBO_POSITION;
  const comboY = Math.max(2, Math.min(height - comboHeight - 2, comboCentre - comboHeight / 2));
  const comboBox: NumberBox = {
    x: stageCentre,
    y: comboY,
    height: comboHeight,
    anchor: 'middle',
    advanceOverlap: sprites.comboOverlap,
  };

  // 判定：官方 LegacyManiaJudgementPiece 是 AutoSizeAxes.Both + 无 Scale ⇒ 字形按贴图自然尺寸，
  // 且两个分支算下来字形中心都落在「距游玩区顶部 ScorePosition」处（Down 时容器底边=判定线）。
  // 未设置 ScorePosition 时用官方默认 300，而不是按屏高猜。
  const judgementSize = sizeOf(sprites.judgement);
  const judgementHeight = naturalHeight(judgementSize, height * 0.092);
  const judgementWidth = judgementSize ? judgementHeight * (judgementSize.w / judgementSize.h) : 0;
  const judgementCentre = scorePosition !== null ? scorePosition : DEFAULT_SCORE_POSITION;
  const judgementY = Math.max(
    judgementHeight / 2 + 1,
    Math.min(height - judgementHeight / 2 - 1, judgementCentre),
  );

  // 血条（scorebar）：wiki（Skinning/Interface）
  // - scorebar-bg：mania 下逆时针旋转 90°、缩小至 0.7 倍，放置于游玩区域底部右侧（定位点=顶部左侧）
  // - scorebar-colour：mania 下逆时针旋转 90°；未使用 scorebar-marker 时位于 (5,16)（768 空间，相对 bg 左上角）
  //   (5,16) 这个偏移是配着贴图自带透明边距用的：例 R Skin 的 scorebar-colour 只有最上面 4 行不透明，
  //   若不按 (5,16) 摆放、又把贴图拉满血条粗细，就会得到一条比血条框更粗、还跑到框外的进度柱。
  const BAR_MANIA_SCALE = 0.7;
  const barUnit = (px: number) => (px / 1.6) * BAR_MANIA_SCALE;
  const scorebarBgSize = sizeOf(sprites.scorebarBg);
  const scorebarColourSize = sizeOf(sprites.scorebarColour);
  const barSourceSize = scorebarBgSize ?? scorebarColourSize;
  const barLength = barSourceSize ? barUnit(barSourceSize.w) : height * 0.63;
  const barThickness = barSourceSize ? barUnit(barSourceSize.h) : height * 0.03;
  // 进度柱（scorebar-colour）：位置按 wiki 的 (5,16)，长度拉伸到血条框末端（被血量裁剪）
  const barFillX = barUnit(5);
  const barFillY = barUnit(16);
  const barFillLength = Math.max(0.5, barLength - barFillX);
  // 皮肤没提供 scorebar-colour 时按同一位置画一条细进度条（自行决定：stable 此时只画 bg）
  const barFillThickness = scorebarColourSize ? barUnit(scorebarColourSize.h) : Math.max(0.8, barThickness * 0.2);
  // stable mania：血条竖直、左缘紧贴轨道右边界（实测 2560x1600 下 x=1737px = 521 单位）
  const barX = stageRight;
  // 游玩区域底部右侧：底端与轨道底边齐平（实测 x=1737px 紧贴轨道右缘、底端到屏幕底）
  const barBottom = height;
  const health = 0.72;

  // 准确率组的水平位置：top-centre 时整体居中于轨道，否则靠右
  let accPieX: number;
  let accTextX: number;
  let accTextAnchor: 'start' | 'end';
  if (accPlacement === 'top-centre') {
    const groupWidth = gaugeRadius * 2 + accGap + accTextWidth;
    const groupLeft = stageCentre - groupWidth / 2;
    accPieX = groupLeft + gaugeRadius;
    accTextX = groupLeft + gaugeRadius * 2 + accGap;
    accTextAnchor = 'start';
  } else {
    const accRight = width - ACC_MARGIN_H * UNITS_PER_PIXEL;
    accTextX = accRight;
    accTextAnchor = 'end';
    accPieX = accRight - accTextWidth - accGap - gaugeRadius;
  }
  const gaugeAngle = Math.PI * 2 * ACCURACY_RATIO - Math.PI / 2;
  const gaugePath =
    'M ' + accPieX + ' ' + (accY - gaugeRadius) +
    ' A ' + gaugeRadius + ' ' + gaugeRadius + ' 0 ' + (ACCURACY_RATIO > 0.5 ? 1 : 0) + ' 1 ' +
    (accPieX + gaugeRadius * Math.cos(gaugeAngle)) + ' ' +
    (accY + gaugeRadius * Math.sin(gaugeAngle)) +
    ' L ' + accPieX + ' ' + accY + ' Z';

  return (
    <g>

      {renderNumber(sprites.scoreDigits, SCORE_VALUE, scoreBox, sizeOf, 'score', 'pv-hud-score')}

      <circle
        cx={accPieX}
        cy={accY}
        r={gaugeRadius}
        fill="rgba(0, 0, 0, 0.35)"
        stroke="#ffffff"
        strokeWidth="0.7"
      />
      <path d={gaugePath} fill="#ffffff" fillOpacity="0.75" />
      {renderNumber(
        sprites.scoreDigits,
        ACCURACY,
        { ...accBox, x: accTextX, anchor: accTextAnchor },
        sizeOf,
        'acc',
        'pv-hud-acc',
      )}

      {renderNumber(sprites.comboDigits, COMBO_VALUE, comboBox, sizeOf, 'combo', 'pv-combo-num')}

      {sprites.judgement && judgementSize ? (
        <image
          href={sprites.judgement}
          x={stageCentre - judgementWidth / 2}
          y={judgementY - judgementHeight / 2}
          width={judgementWidth}
          height={judgementHeight}
          preserveAspectRatio="none"
        />
      ) : (
        <text
          className="pv-judgement"
          x={stageCentre}
          y={judgementY + judgementHeight * 0.3}
          textAnchor="middle"
          fontSize={judgementHeight * 0.8}
        >
          300
        </text>
      )}

      <g transform={'translate(' + barX + ' ' + barBottom + ') rotate(-90)'}>
        {sprites.scorebarBg ? (
          <image
            href={sprites.scorebarBg}
            x={0}
            y={0}
            width={barLength}
            height={barThickness}
            preserveAspectRatio="none"
          />
        ) : (
          <rect x={0} y={0} width={barLength} height={barThickness} fill="rgba(0, 0, 0, 0.45)" />
        )}
        <clipPath id="pv-hud-health">
          <rect x={barFillX} y={barFillY} width={barFillLength * health} height={barFillThickness} />
        </clipPath>
        <g clipPath="url(#pv-hud-health)">
          {sprites.scorebarColour ? (
            <image
              href={sprites.scorebarColour}
              x={barFillX}
              y={barFillY}
              width={barFillLength}
              height={barFillThickness}
              preserveAspectRatio="none"
            />
          ) : (
            <rect
              x={barFillX}
              y={barFillY}
              width={barFillLength}
              height={barFillThickness}
              fill="#7ef0a0"
            />
          )}
        </g>
      </g>
    </g>
  );
}
