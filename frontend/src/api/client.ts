export interface FieldSpec {
  name: string;
  label: string;
  group: string;
  type:
    | 'number'
    | 'int'
    | 'bool'
    | 'enum'
    | 'rgb'
    | 'rgba'
    | 'text'
    | 'list_number'
    | 'list_int';
  defaultValue: string;
  perColumn: boolean;
  indexStart: number;
  indexSuffix: string;
  enumValues: string[];
  help: string;
  requiresVersion25: boolean;
}

export interface LocalProfile {
  ok: boolean;
  width: number;
  height: number;
  hasContent: boolean;
  content: { minX: number; maxX: number; minY: number; maxY: number };
  edges: {
    left: number[];
    right: number[];
    top: number[];
    bottom: number[];
  };
}

export interface SkinInfo {
  name: string;
  path: string;
  hasIni: boolean;
  keys: number[];
  error?: string;
  styleCount?: number;
  styleSummary?: Record<string, string[]>;
}

export interface ManiaBlock {
  keys: number | null;
  values: Record<string, string>;
}

export interface SkinData {
  path: string;
  hasIni: boolean;
  version?: string | null;
  blocks: ManiaBlock[];
  warnings: string[];
  raw: string;
}

export interface SkinOpsState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string;
  redoLabel: string;
}

export interface HistoryEntry {
  path: string;
  lastUsed: string;
}

export interface SkinStyle {
  name: string;
  values: Record<string, string>;
}

export type StyleMap = Record<string, SkinStyle[]>;

export interface PngMetrics {
  valid: boolean;
  width: number;
  height: number;
  topSpacing: number;
  leftSpacing: number;
  rightSpacing: number;
  bottomSpacing: number;
  minAlpha: number;
  maxAlpha: number;
  fullyTransparentCount: number;
  fullyOpaqueCount: number;
  totalPixels: number;
}

interface ApiErrorBody {
  error?: string;
  errors?: string[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // keep data null for non-JSON responses
  }
  if (!response.ok) {
    const body = (data ?? {}) as ApiErrorBody;
    const detail = body.errors?.length
      ? body.errors.join('；')
      : body.error ?? `请求失败（${response.status}）`;
    throw new Error(detail);
  }
  return data as T;
}

export const api = {
  health: () => request<{ ok: boolean }>('/api/health'),

  schema: () => request<{ fields: FieldSpec[] }>('/api/schema'),

  history: () => request<{ entries: HistoryEntry[] }>('/api/history'),

  removeHistory: (path: string) =>
    request<{ ok: boolean; entries: HistoryEntry[] }>('/api/history/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }),

  pickSkinDir: () =>
    request<{ cancelled: boolean; path?: string }>('/api/skin-dir/pick', {
      method: 'POST',
    }),

  openSkinDir: (path: string) =>
    request<{ path: string; skins: SkinInfo[] }>('/api/skin-dir/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }),

  getSkin: (path: string) =>
    request<SkinData>(`/api/skin?path=${encodeURIComponent(path)}`),

  getRawIni: (path: string) =>
    fetch(`/api/skin/ini?path=${encodeURIComponent(path)}`).then((r) =>
      r.text(),
    ),

  saveMania: (
    path: string,
    keys: number,
    updates: Array<{ key: string; value: string }>,
  ) =>
    request<{
      ok: boolean;
      backup: string;
      version: string | null;
      warnings: string[];
    }>('/api/skin/mania', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, keys, updates }),
    }),

  images: (path: string) =>
    request<{ images: string[] }>(
      `/api/skin/images?path=${encodeURIComponent(path)}`,
    ),

  cloneSkin: (path: string) =>
    request<{ ok: boolean; name: string; path: string }>('/api/skin/clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }),

  renameSkin: (path: string, newName: string) =>
    request<{ ok: boolean; name: string; path: string }>('/api/skin/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, newName }),
    }),

  deleteSkin: (path: string) =>
    request<{ ok: boolean }>('/api/skin/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }),

  undoOps: () =>
    request<{ ok: boolean }>('/api/skin/undo', { method: 'POST' }),

  redoOps: () =>
    request<{ ok: boolean }>('/api/skin/redo', { method: 'POST' }),

  opsState: () => request<SkinOpsState>('/api/skin/ops'),

  getStyles: (path: string) =>
    request<{ path: string; styles: StyleMap }>(
      `/api/skin/styles?path=${encodeURIComponent(path)}`,
    ),

  saveStyle: (path: string, keys: number, name: string, values: Record<string, string>) =>
    request<{ ok: boolean; styles: StyleMap }>('/api/skin/styles/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, keys, name, values }),
    }),

  deleteStyle: (path: string, keys: number, name: string) =>
    request<{ ok: boolean; styles: StyleMap }>('/api/skin/styles/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, keys, name }),
    }),

  renameStyle: (path: string, keys: number, oldName: string, newName: string) =>
    request<{ ok: boolean; styles: StyleMap }>('/api/skin/styles/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, keys, oldName, newName }),
    }),

  imageUrl: (path: string, name: string) =>
    `/api/skin/image?path=${encodeURIComponent(path)}&name=${encodeURIComponent(
      name,
    )}`,

  imageInfo: (path: string, name: string) =>
    request<{ ok: boolean; name: string; metrics: PngMetrics }>(
      `/api/skin/image/info?path=${encodeURIComponent(
        path,
      )}&name=${encodeURIComponent(name)}`,
    ),

  pickImage: (path: string) =>
    request<{ cancelled: boolean; name?: string; path?: string }>(
      '/api/skin/image/pick',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      },
    ),

  editImage: (
    path: string,
    name: string,
    targetName: string,
    options: {
      top: number;
      left: number;
      right: number;
      alphaScalePercent: number;
      alphaValue: number;
    },
  ) =>
    request<{
      ok: boolean;
      name: string;
      backup?: string;
      metrics: PngMetrics;
    }>('/api/skin/image/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path,
        name,
        targetName,
        top: options.top,
        left: options.left,
        right: options.right,
        alphaScalePercent: options.alphaScalePercent,
        alphaValue: options.alphaValue,
      }),
    }),

  async previewImage(
    path: string,
    name: string,
    options: {
      top: number;
      left: number;
      right: number;
      alphaScalePercent: number;
      alphaValue: number;
    },
  ): Promise<{ url: string; width: number; height: number }> {
    const response = await fetch('/api/skin/image/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path,
        name,
        top: options.top,
        left: options.left,
        right: options.right,
        alphaScalePercent: options.alphaScalePercent,
        alphaValue: options.alphaValue,
      }),
    });
    if (!response.ok) {
      let message = '生成修改预览失败';
      try {
        const body = await response.json();
        message = (body as { error?: string }).error ?? message;
      } catch {
        // keep default message
      }
      throw new Error(message);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const width = Number(response.headers.get('X-Preview-Width')) || 0;
    const height = Number(response.headers.get('X-Preview-Height')) || 0;
    return { url, width, height };
  },

  async previewWorkingImage(
    workId: string,
    options: {
      top: number;
      left: number;
      right: number;
      alphaScalePercent: number;
      alphaValue: number;
    },
  ): Promise<{ url: string; width: number; height: number }> {
    const response = await fetch('/api/skin/image/preview-working', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workId, ...options }),
    });

    if (!response.ok) {
      let message = '生成修改预览失败';
      try {
        const body = await response.json();
        message = (body as { error?: string }).error ?? message;
      } catch {
        // keep default message
      }
      throw new Error(message);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const width = Number(response.headers.get('X-Preview-Width')) || 0;
    const height = Number(response.headers.get('X-Preview-Height')) || 0;
    return { url, width, height };
  },

  startLocalSession: (path: string, name: string) =>
    request<{
      ok: boolean;
      workId: string;
      metrics: PngMetrics;
      canUndo: boolean;
      canRedo: boolean;
    }>(
      '/api/skin/image/local/start',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, name }),
      },
    ),

  transformLocal: (
    workId: string,
    source: { x0: number; y0: number; x1: number; y1: number },
    target: { x0: number; y0: number; x1: number; y1: number },
  ) =>
    request<{
      ok: boolean;
      metrics: PngMetrics;
      canUndo: boolean;
      canRedo: boolean;
    }>(
      '/api/skin/image/local/transform',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workId,
          sourceX0: source.x0,
          sourceY0: source.y0,
          sourceX1: source.x1,
          sourceY1: source.y1,
          targetX0: target.x0,
          targetY0: target.y0,
          targetX1: target.x1,
          targetY1: target.y1,
        }),
      },
    ),

  drawBorderLineLocal: (
    workId: string,
    options: {
      side: 'top' | 'bottom' | 'left' | 'right';
      position: number;
      width: number;
      r: number;
      g: number;
      b: number;
      a: number;
    },
  ) =>
    request<{
      ok: boolean;
      metrics: PngMetrics;
      canUndo: boolean;
      canRedo: boolean;
    }>('/api/skin/image/local/border-line', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workId, ...options }),
    }),

  localProfile: (workId: string) =>
    request<LocalProfile>('/api/skin/image/local/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workId }),
    }),

  undoLocal: (workId: string) =>
    request<{
      ok: boolean;
      metrics: PngMetrics;
      canUndo: boolean;
      canRedo: boolean;
    }>(
      '/api/skin/image/local/undo',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workId }),
      },
    ),

  redoLocal: (workId: string) =>
    request<{
      ok: boolean;
      metrics: PngMetrics;
      canUndo: boolean;
      canRedo: boolean;
    }>(
      '/api/skin/image/local/redo',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workId }),
      },
    ),

  workImageUrl: (workId: string, revision: number) =>
    `/api/skin/image/working?workId=${encodeURIComponent(
      workId,
    )}&t=${revision}`,

  saveWorking: (
    workId: string,
    path: string,
    name: string,
    targetName: string,
    options: {
      top: number;
      left: number;
      right: number;
      alphaScalePercent: number;
      alphaValue: number;
    },
  ) =>
    request<{
      ok: boolean;
      name: string;
      backup?: string;
      metrics: PngMetrics;
    }>('/api/skin/image/save-working', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workId,
        path,
        name,
        targetName,
        top: options.top,
        left: options.left,
        right: options.right,
        alphaScalePercent: options.alphaScalePercent,
        alphaValue: options.alphaValue,
      }),
    }),

  saveAsImage: (
    path: string,
    name: string,
    workId: string | null,
    options: {
      top: number;
      left: number;
      right: number;
      alphaScalePercent: number;
      alphaValue: number;
    },
  ) =>
    request<{
      ok: boolean;
      cancelled: boolean;
      name?: string;
      path?: string;
      metrics?: PngMetrics;
    }>('/api/skin/image/save-as', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path,
        name,
        workId: workId ?? '',
        top: options.top,
        left: options.left,
        right: options.right,
        alphaScalePercent: options.alphaScalePercent,
        alphaValue: options.alphaValue,
      }),
    }),
};
