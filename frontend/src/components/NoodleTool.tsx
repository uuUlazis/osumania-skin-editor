import { useEffect, useRef, useState } from 'react';
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Crop,
  FolderOpen,
  Frame,
  ImagePlus,
  Move,
  Redo2,
  Save,
  Undo2,
} from 'lucide-react';
import { api } from '../api/client';
import type { PngMetrics } from '../api/client';

interface NoodleToolProps {
  skinPath: string;
  onClose: () => void;
  notify: (type: 'ok' | 'error' | 'warn', text: string) => void;
}

type BackgroundMode = 'checker' | 'black' | 'white' | 'green';
type PreviewMode = 'original' | 'modified';

interface SourceImage {
  image: HTMLImageElement;
  width: number;
  height: number;
}

interface CachedPreview {
  url: string;
  width: number;
  height: number;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface DragState {
  mode: 'draw' | 'move' | 'resize';
  startX: number;
  startY: number;
  base: Rect;
  handle?: string;
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-box">
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
    </div>
  );
}

export function NoodleTool({ skinPath, onClose, notify }: NoodleToolProps) {
  const [images, setImages] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [metrics, setMetrics] = useState<PngMetrics | null>(null);
  const [source, setSource] = useState<SourceImage | null>(null);
  const [top, setTop] = useState('');
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [alphaMode, setAlphaMode] = useState<'keep' | 'scale' | 'fixed'>(
    'keep',
  );
  const [alphaScale, setAlphaScale] = useState('100');
  const [alphaValue, setAlphaValue] = useState('255');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [background, setBackground] = useState<BackgroundMode>('checker');
  const [previewMode, setPreviewMode] = useState<PreviewMode>('original');
  const [modifiedUrl, setModifiedUrl] = useState<string | null>(null);
  const [modifiedError, setModifiedError] = useState<string | null>(null);
  const [modifiedLoading, setModifiedLoading] = useState(false);
  const [modifiedDims, setModifiedDims] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const previewCacheRef = useRef<Map<string, CachedPreview>>(new Map());
  const [localTool, setLocalTool] = useState<
    'marquee' | 'adjust' | 'transform' | null
  >(null);
  const [workId, setWorkId] = useState<string | null>(null);
  const [workRevision, setWorkRevision] = useState(0);
  const [canUndoLocal, setCanUndoLocal] = useState(false);
  const [canRedoLocal, setCanRedoLocal] = useState(false);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [transformBase, setTransformBase] = useState<Rect | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  const viewerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .images(skinPath)
      .then((result) => {
        if (!cancelled) {
          setImages(
            result.images.filter((item) => item.toLowerCase().endsWith('.png')),
          );
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [skinPath]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      setZoom((current) => Math.min(8, Math.max(0.2, current * factor)));
    };
    viewer.addEventListener('wheel', onWheel, { passive: false });
    return () => viewer.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    if (previewMode !== 'modified' || !name || !metrics) {
      setModifiedUrl(null);
      setModifiedDims(null);
      setModifiedError(null);
      return;
    }
    const previewKey = [
      name,
      workId ?? '',
      workRevision,
      top,
      left,
      right,
      alphaMode,
      alphaScale,
      alphaValue,
    ].join('|');
    const cached = previewCacheRef.current.get(previewKey);
    if (cached) {
      setModifiedUrl(cached.url);
      setModifiedDims({ width: cached.width, height: cached.height });
      setModifiedError(null);
      setModifiedLoading(false);
      return;
    }
    setModifiedLoading(true);
    setModifiedError(null);
    const timer = window.setTimeout(async () => {
      try {
        const options = {
          top: Number(top) || 0,
          left: Number(left) || 0,
          right: Number(right) || 0,
          alphaScalePercent:
            alphaMode === 'scale' ? Number(alphaScale) || 100 : 100,
          alphaValue: alphaMode === 'fixed' ? Number(alphaValue) || 0 : -1,
        };
        const result = workId
          ? await api.previewWorkingImage(workId, options)
          : await api.previewImage(skinPath, name, options);
        const entry: CachedPreview = {
          url: result.url,
          width: result.width,
          height: result.height,
        };
        const cache = previewCacheRef.current;
        if (cache.size >= 30) {
          const oldestKey = cache.keys().next().value;
          if (oldestKey) {
            const oldest = cache.get(oldestKey);
            if (oldest) {
              URL.revokeObjectURL(oldest.url);
            }
            cache.delete(oldestKey);
          }
        }
        cache.set(previewKey, entry);
        setModifiedUrl(entry.url);
        setModifiedDims({ width: entry.width, height: entry.height });
      } catch (error) {
        setModifiedError(errorText(error));
      } finally {
        setModifiedLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    previewMode,
    name,
    metrics,
    skinPath,
    top,
    left,
    right,
    alphaMode,
    alphaScale,
    alphaValue,
    workId,
    workRevision,
  ]);

  useEffect(
    () => () => {
      for (const entry of previewCacheRef.current.values()) {
        URL.revokeObjectURL(entry.url);
      }
      previewCacheRef.current.clear();
    },
    [],
  );

  async function loadSource(nextName: string, cacheBust?: number) {
    const url = `${api.imageUrl(skinPath, nextName)}${
      cacheBust ? `&t=${cacheBust}` : ''
    }`;
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('图片加载失败'));
      image.src = url;
    });
    setSource({
      image,
      width: image.naturalWidth || 1,
      height: image.naturalHeight || 1,
    });
  }

  async function selectImage(nextName: string) {
    setName(nextName);
    setMetrics(null);
    setSource(null);
    setZoom(1);
    resetLocalState();
    if (!nextName) {
      return;
    }
    setBusy(true);
    try {
      const result = await api.imageInfo(skinPath, nextName);
      applyMetrics(result.metrics);
      await loadSource(nextName, Date.now());
      setRevision((current) => current + 1);
    } catch (error) {
      notify('error', errorText(error));
    } finally {
      setBusy(false);
    }
  }

  function applyMetrics(next: PngMetrics) {
    setMetrics(next);
    setTop(String(next.topSpacing));
    setLeft(String(next.leftSpacing));
    setRight(String(next.rightSpacing));
  }

  function resetLocalState() {
    setWorkId(null);
    setWorkRevision(0);
    setCanUndoLocal(false);
    setCanRedoLocal(false);
    setSelection(null);
    setTransformBase(null);
    setLocalTool(null);
    dragRef.current = null;
  }

  async function loadFromUrl(url: string) {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('图片加载失败'));
      image.src = url;
    });
    setSource({
      image,
      width: image.naturalWidth || 1,
      height: image.naturalHeight || 1,
    });
  }

  async function ensureSession(): Promise<string | null> {
    if (workId) {
      return workId;
    }
    try {
      const result = await api.startLocalSession(skinPath, name);
      setWorkId(result.workId);
      setCanUndoLocal(result.canUndo);
      setCanRedoLocal(result.canRedo);
      return result.workId;
    } catch (error) {
      notify('error', errorText(error));
      return null;
    }
  }

  function acceptMetrics(next: PngMetrics) {
    setMetrics(next);
    setTop(String(next.topSpacing));
    setLeft(String(next.leftSpacing));
    setRight(String(next.rightSpacing));
  }

  async function reloadWorking(id: string) {
    const url = `${api.workImageUrl(id, Date.now())}`;
    await loadFromUrl(url);
    setWorkRevision((current) => current + 1);
  }

  function currentImageSrc(): string {
    return workId
      ? api.workImageUrl(workId, workRevision)
      : `${api.imageUrl(skinPath, name)}&t=${revision}`;
  }

  function normalizeRect(rect: Rect): Rect {
    return {
      x0: Math.min(rect.x0, rect.x1),
      y0: Math.min(rect.y0, rect.y1),
      x1: Math.max(rect.x0, rect.x1),
      y1: Math.max(rect.y0, rect.y1),
    };
  }

  function imagePointFromEvent(event: ReactPointerEvent): {
    x: number;
    y: number;
  } {
    const frame = frameRef.current;
    if (!frame || !source) {
      return { x: 0, y: 0 };
    }
    const bounds = frame.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(source.width - 1,
        Math.round(((event.clientX - bounds.left) / bounds.width) * source.width)),
    );
    const y = Math.max(
      0,
      Math.min(source.height - 1,
        Math.round(((event.clientY - bounds.top) / bounds.height) * source.height)),
    );
    return { x, y };
  }

  function pointInside(rect: Rect, x: number, y: number): boolean {
    return x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
  }

  async function applyLocalTransform(sourceRect: Rect, targetRect: Rect) {
    const id = await ensureSession();
    if (!id) {
      return;
    }
    try {
      const result = await api.transformLocal(id, sourceRect, targetRect);
      acceptMetrics(result.metrics);
      setCanUndoLocal(result.canUndo);
      setCanRedoLocal(result.canRedo);
      await reloadWorking(id);
      const next = normalizeRect(targetRect);
      setSelection(next);
      setTransformBase(next);
      notify('ok', '自由变换已应用');
    } catch (error) {
      notify('error', errorText(error));
    }
  }

  async function localHistory(isUndo: boolean) {
    if (!workId) {
      notify('warn', '请先选择并变换区域');
      return;
    }
    try {
      const result = isUndo
        ? await api.undoLocal(workId)
        : await api.redoLocal(workId);
      acceptMetrics(result.metrics);
      setCanUndoLocal(result.canUndo);
      setCanRedoLocal(result.canRedo);
      await reloadWorking(workId);
      setSelection(null);
      setTransformBase(null);
      notify('ok', isUndo ? '已撤销上一步变换' : '已重做变换');
    } catch (error) {
      notify('error', errorText(error));
    }
  }

  function handleFramePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!source || !localTool) {
      return;
    }
    event.preventDefault();
    const point = imagePointFromEvent(event);
    const handle = (event.target as HTMLElement).dataset.handle;
    const canManipulateSelection =
      localTool === 'transform' || localTool === 'adjust';
    if (handle && canManipulateSelection && selection) {
      dragRef.current = {
        mode: 'resize',
        startX: point.x,
        startY: point.y,
        base: selection,
        handle,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (localTool === 'marquee') {
      const rect = {
        x0: point.x,
        y0: point.y,
        x1: point.x,
        y1: point.y,
      };
      setSelection(rect);
      dragRef.current = {
        mode: 'draw',
        startX: point.x,
        startY: point.y,
        base: rect,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (
      canManipulateSelection &&
      selection &&
      pointInside(selection, point.x, point.y)
    ) {
      dragRef.current = {
        mode: 'move',
        startX: point.x,
        startY: point.y,
        base: selection,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function clampCoordinate(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  function handleFramePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || !source) {
      return;
    }
    event.preventDefault();
    const point = imagePointFromEvent(event);
    if (drag.mode === 'draw') {
      setSelection(
        normalizeRect({
          x0: drag.startX,
          y0: drag.startY,
          x1: point.x,
          y1: point.y,
        }),
      );
      return;
    }
    if (drag.mode === 'move') {
      const dx = point.x - drag.startX;
      const dy = point.y - drag.startY;
      const width = drag.base.x1 - drag.base.x0;
      const height = drag.base.y1 - drag.base.y0;
      const x0 = clampCoordinate(
        drag.base.x0 + dx,
        0,
        Math.max(0, source.width - 1 - width),
      );
      const y0 = clampCoordinate(
        drag.base.y0 + dy,
        0,
        Math.max(0, source.height - 1 - height),
      );
      setSelection({
        x0,
        y0,
        x1: x0 + width,
        y1: y0 + height,
      });
      return;
    }
    const next = { ...drag.base };
    const min = 2;
    const handle = drag.handle ?? '';
    if (handle.includes('n')) {
      next.y0 = clampCoordinate(point.y, 0, drag.base.y1 - min);
    }
    if (handle.includes('s')) {
      next.y1 = clampCoordinate(point.y, drag.base.y0 + min, source.height - 1);
    }
    if (handle.includes('w')) {
      next.x0 = clampCoordinate(point.x, 0, drag.base.x1 - min);
    }
    if (handle.includes('e')) {
      next.x1 = clampCoordinate(point.x, drag.base.x0 + min, source.width - 1);
    }
    setSelection(next);
  }

  function handleFramePointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !source) {
      return;
    }
    if (drag.mode === 'draw' && selection) {
      const rect = normalizeRect(selection);
      const area = (rect.x1 - rect.x0 + 1) * (rect.y1 - rect.y0 + 1);
      if (area >= 4) {
        setSelection(rect);
        setTransformBase(rect);
        setLocalTool(null);
      } else {
        setSelection(null);
      }
      return;
    }
    if (
      (drag.mode === 'move' || drag.mode === 'resize') &&
      selection &&
      transformBase
    ) {
      const target = normalizeRect(selection);
      if (localTool === 'adjust') {
        setSelection(target);
        setTransformBase(target);
        return;
      }
      const changed =
        target.x0 !== transformBase.x0 ||
        target.y0 !== transformBase.y0 ||
        target.x1 !== transformBase.x1 ||
        target.y1 !== transformBase.y1;
      if (changed) {
        void applyLocalTransform(transformBase, target);
      } else {
        setSelection(transformBase);
      }
    }
  }

  function rectStyle(): CSSProperties {
    if (!selection) {
      return {};
    }
    return {
      left: selection.x0 * zoom,
      top: selection.y0 * zoom,
      width: (selection.x1 - selection.x0 + 1) * zoom,
      height: (selection.y1 - selection.y0 + 1) * zoom,
    };
  }

  function previewBackground(): CSSProperties {
    if (background === 'black') {
      return { background: '#000000' };
    }
    if (background === 'white') {
      return { background: '#ffffff' };
    }
    if (background === 'green') {
      return { background: '#00b140' };
    }
    return {
      background:
        'repeating-conic-gradient(#262c34 0% 25%, #11151a 0% 50%) 0 0 / 24px 24px',
    };
  }

  async function saveCurrentImage() {
    if (!name || !metrics) {
      return;
    }
    setBusy(true);
    try {
      const alphaScalePercent =
        alphaMode === 'scale' ? Number(alphaScale) || 100 : 100;
      const alphaFixed =
        alphaMode === 'fixed' ? Number(alphaValue) || 0 : -1;
      const options = {
        top: Number(top) || 0,
        left: Number(left) || 0,
        right: Number(right) || 0,
        alphaScalePercent,
        alphaValue: alphaFixed,
      };
      const result = workId
        ? await api.saveWorking(workId, skinPath, name, name, options)
        : await api.editImage(skinPath, name, name, options);
      applyMetrics(result.metrics);
      resetLocalState();
      await loadSource(name, Date.now());
      setRevision((current) => current + 1);
      notify(
        'ok',
        result.backup
          ? '图片已保存，原图已备份为 .bak 文件'
          : '图片已保存',
      );
    } catch (error) {
      notify('error', errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveAsWithDialog() {
    if (!name || !metrics) {
      return;
    }
    setBusy(true);
    try {
      const alphaScalePercent =
        alphaMode === 'scale' ? Number(alphaScale) || 100 : 100;
      const alphaFixed =
        alphaMode === 'fixed' ? Number(alphaValue) || 0 : -1;
      const result = await api.saveAsImage(skinPath, name, workId, {
        top: Number(top) || 0,
        left: Number(left) || 0,
        right: Number(right) || 0,
        alphaScalePercent,
        alphaValue: alphaFixed,
      });
      if (result.cancelled) {
        return;
      }
      notify('ok', `图片已另存为：${result.path ?? result.name ?? ''}`);
    } catch (error) {
      notify('error', errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function pickFromExplorer() {
    setBusy(true);
    try {
      const result = await api.pickImage(skinPath);
      if (result.cancelled || !result.name) {
        return;
      }
      setImages((current) =>
        current.includes(result.name as string)
          ? current
          : [...current, result.name as string],
      );
      await selectImage(result.name);
    } catch (error) {
      notify('error', errorText(error));
    } finally {
      setBusy(false);
    }
  }

  function formatCount(value: number): string {
    return value.toLocaleString('zh-CN');
  }

  const imageOptions = images.filter((item) =>
    item.toLowerCase().endsWith('.png'),
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal noodle-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="noodle-head">
          <h3>
            <ImagePlus size={17} />
            面条身图像调整
          </h3>
          <button
            type="button"
            className="icon-btn close-btn"
            title="关闭"
            onClick={onClose}
          >
            <span className="close-mark">×</span>
          </button>
        </div>

        <div className="noodle-body">
          <div className="noodle-controls">
            <div className="noodle-field">
              <label>图片素材</label>
              <select
                value={name}
                onChange={(event) => selectImage(event.target.value)}
              >
                <option value="">请选择 PNG 图片…</option>
                {imageOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            <div className="picker-actions">
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={pickFromExplorer}
              >
                <FolderOpen size={14} />
                从资源管理器选择
              </button>
              <span className="picker-hint">
                下拉列表包含皮肤目录子文件夹中的图片
              </span>
            </div>

            {metrics ? (
              <div className="metric-grid">
                <MetricBox
                  label="尺寸"
                  value={`${metrics.width} × ${metrics.height}`}
                />
                <MetricBox
                  label="顶部留白"
                  value={`${metrics.topSpacing} px`}
                />
                <MetricBox
                  label="左侧留白"
                  value={`${metrics.leftSpacing} px`}
                />
                <MetricBox
                  label="右侧留白"
                  value={`${metrics.rightSpacing} px`}
                />
                <MetricBox
                  label="底部留白"
                  value={`${metrics.bottomSpacing} px`}
                />
                <MetricBox
                  label="Alpha 范围"
                  value={`${metrics.minAlpha} - ${metrics.maxAlpha}`}
                />
                <MetricBox
                  label="全透明像素"
                  value={formatCount(metrics.fullyTransparentCount)}
                />
                <MetricBox
                  label="不透明像素"
                  value={formatCount(metrics.fullyOpaqueCount)}
                />
              </div>
            ) : (
              <div className="metric-empty">
                选择图片后自动识别留白与透明度
              </div>
            )}

            {metrics && (
              <>
                <div className="noodle-fields">
                  <div className="noodle-field">
                    <label>目标顶部留白</label>
                    <input
                      type="number"
                      min={0}
                      value={top}
                      onChange={(event) => setTop(event.target.value)}
                    />
                  </div>
                  <div className="noodle-field">
                    <label>目标左侧留白</label>
                    <input
                      type="number"
                      min={0}
                      value={left}
                      onChange={(event) => setLeft(event.target.value)}
                    />
                  </div>
                  <div className="noodle-field">
                    <label>目标右侧留白</label>
                    <input
                      type="number"
                      min={0}
                      value={right}
                      onChange={(event) => setRight(event.target.value)}
                    />
                  </div>
                  <div className="noodle-field">
                    <label>Alpha 处理</label>
                    <select
                      value={alphaMode}
                      onChange={(event) =>
                        setAlphaMode(event.target.value as typeof alphaMode)
                      }
                    >
                      <option value="keep">保持不变</option>
                      <option value="scale">按百分比缩放</option>
                      <option value="fixed">统一设为固定值</option>
                    </select>
                  </div>
                  {alphaMode === 'scale' && (
                    <div className="noodle-field">
                      <label>整体透明度 %</label>
                      <input
                        type="number"
                        min={0}
                        max={1000}
                        value={alphaScale}
                        onChange={(event) => setAlphaScale(event.target.value)}
                      />
                    </div>
                  )}
                  {alphaMode === 'fixed' && (
                    <div className="noodle-field">
                      <label>固定 Alpha 值</label>
                      <input
                        type="number"
                        min={0}
                        max={255}
                        value={alphaValue}
                        onChange={(event) => setAlphaValue(event.target.value)}
                      />
                    </div>
                  )}
                </div>

                <div className="noodle-save-row">
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() => void saveCurrentImage()}
                  >
                    <Save size={15} />
                    保存到当前图片
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy}
                    onClick={() => void saveAsWithDialog()}
                  >
                    <Save size={15} />
                    另存为…
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="noodle-preview-panel">
            <div className="preview-toolbar">
              <span className="preview-title">预览</span>
              <div className="segmented">
                <button
                  type="button"
                  className={previewMode === 'original' ? 'active' : ''}
                  onClick={() => setPreviewMode('original')}
                >
                  原图
                </button>
                <button
                  type="button"
                  className={previewMode === 'modified' ? 'active' : ''}
                  onClick={() => setPreviewMode('modified')}
                >
                  修改效果
                </button>
              </div>
              <div className="preview-zoom">
                <button
                  type="button"
                  className="zoom-btn"
                  onClick={() =>
                    setZoom((current) => Math.max(0.2, current / 1.25))
                  }
                >
                  −
                </button>
                <span className="zoom-value">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  className="zoom-btn"
                  onClick={() =>
                    setZoom((current) => Math.min(8, current * 1.25))
                  }
                >
                  ＋
                </button>
              </div>
            </div>
            <div className="preview-bg-row">
              <span className="preview-title">预览底色</span>
              {(
                [
                  ['checker', '默认'],
                  ['black', '黑底'],
                  ['white', '白底'],
                  ['green', '绿底'],
                ] as Array<[BackgroundMode, string]>
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  className={`bg-chip ${background === mode ? 'active' : ''}`}
                  onClick={() => setBackground(mode)}
                >
                  <span className={`bg-swatch bg-${mode}`} />
                  {label}
                </button>
              ))}
            </div>
            <div className="preview-workspace">
              <div
                className="preview-scroll"
                ref={viewerRef}
                onPointerDown={handleFramePointerDown}
                onPointerMove={handleFramePointerMove}
                onPointerUp={handleFramePointerUp}
                onPointerCancel={handleFramePointerUp}
              >
                {source && previewMode === 'original' ? (
                  <div
                    className="preview-frame"
                    ref={frameRef}
                    style={{
                      width: Math.max(1, Math.round(source.width * zoom)),
                      height: Math.max(1, Math.round(source.height * zoom)),
                    }}
                  >
                    <img
                      className="preview-image"
                      src={currentImageSrc()}
                      alt=""
                      draggable={false}
                      style={{
                        width: '100%',
                        height: '100%',
                        imageRendering: 'pixelated',
                        ...previewBackground(),
                      }}
                    />
                    {selection && (
                      <div
                        className={`selection-box ${
                          localTool === 'transform' || localTool === 'adjust'
                            ? 'active'
                            : ''
                        }`}
                        style={rectStyle()}
                      >
                        {(localTool === 'transform' ||
                          localTool === 'adjust') && (
                          <>
                            {['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(
                              (handle) => (
                                <span
                                  key={handle}
                                  className={`selection-handle handle-${handle}`}
                                  data-handle={handle}
                                />
                              ),
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ) : modifiedUrl ? (
                  <img
                    className="preview-image"
                    src={modifiedUrl}
                    alt=""
                    draggable={false}
                    style={{
                      width: Math.max(
                        1,
                        Math.round((modifiedDims?.width ?? 1) * zoom),
                      ),
                      height: Math.max(
                        1,
                        Math.round((modifiedDims?.height ?? 1) * zoom),
                      ),
                      imageRendering: 'pixelated',
                      ...previewBackground(),
                    }}
                  />
                ) : (
                  <div className="preview-placeholder">
                    {!source
                      ? '选择图片后在此预览，滚轮可缩放'
                      : modifiedLoading
                        ? '正在生成修改预览…'
                        : modifiedError ?? '修改效果预览生成失败'}
                  </div>
                )}
              </div>
              <div className="local-tools">
                <button
                  type="button"
                  className={`local-tool-btn ${
                    localTool === 'marquee' ? 'active' : ''
                  }`}
                  title="框选局部范围"
                  onClick={() => {
                    void ensureSession().then((id) => {
                      if (id) {
                        setLocalTool('marquee');
                      }
                    });
                  }}
                >
                  <Crop size={16} />
                  框选
                </button>
                <button
                  type="button"
                  className={`local-tool-btn ${
                    localTool === 'adjust' ? 'active' : ''
                  }`}
                  title="调整选区范围，不修改图像内容"
                  disabled={!selection}
                  onClick={() => setLocalTool('adjust')}
                >
                  <Frame size={16} />
                  变换选区
                </button>
                <button
                  type="button"
                  className={`local-tool-btn ${
                    localTool === 'transform' ? 'active' : ''
                  }`}
                  title="对选中区域执行自由变换"
                  disabled={!selection}
                  onClick={() => setLocalTool('transform')}
                >
                  <Move size={16} />
                  自由变换
                </button>
                <button
                  type="button"
                  className="local-tool-btn"
                  title="撤销上一步变换"
                  disabled={!workId || !canUndoLocal}
                  onClick={() => void localHistory(true)}
                >
                  <Undo2 size={16} />
                  撤销
                </button>
                <button
                  type="button"
                  className="local-tool-btn"
                  title="重做变换"
                  disabled={!workId || !canRedoLocal}
                  onClick={() => void localHistory(false)}
                >
                  <Redo2 size={16} />
                  重做
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
