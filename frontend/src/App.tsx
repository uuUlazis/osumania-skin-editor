import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  Music4,
  Redo2,
  RefreshCw,
  Undo2,
  X,
} from 'lucide-react';
import { api } from './api/client';
import type {
  FieldSpec,
  HistoryEntry,
  SkinData,
  SkinInfo,
  SkinOpsState,
  SkinStyle,
  StyleMap,
} from './api/client';
import { EditorPane } from './components/EditorPane';
import { NoodleTool } from './components/NoodleTool';
import { SkinSidebar } from './components/SkinSidebar';
import { concreteKeys, validateValue } from './components/fields';

interface Notice {
  type: 'ok' | 'error' | 'warn';
  text: string;
}

type ModalKind = 'clone' | 'rename' | 'delete';

interface ModalState {
  kind: ModalKind;
  skin: SkinInfo;
}

const EMPTY_OPS: SkinOpsState = {
  canUndo: false,
  canRedo: false,
  undoLabel: '',
  redoLabel: '',
};

export default function App() {
  const [schema, setSchema] = useState<FieldSpec[]>([]);
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [boundDir, setBoundDir] = useState<string | null>(null);
  const [skins, setSkins] = useState<SkinInfo[]>([]);
  const [selectedSkin, setSelectedSkin] = useState<SkinInfo | null>(null);
  const [skinData, setSkinData] = useState<SkinData | null>(null);
  const [activeKeys, setActiveKeys] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<
    Record<number, Record<string, string>>
  >({});
  const [dirtyKeys, setDirtyKeys] = useState<Set<number>>(new Set());
  const [showRaw, setShowRaw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [ops, setOps] = useState<SkinOpsState>(EMPTY_OPS);
  const [styles, setStyles] = useState<StyleMap>({});
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [noodleOpen, setNoodleOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  useEffect(() => {
    api
      .health()
      .then(() => setBackendOk(true))
      .catch(() => setBackendOk(false));
    api
      .schema()
      .then((result) => setSchema(result.fields))
      .catch(() => setBackendOk(false));
    api
      .history()
      .then((result) => setHistory(result.entries))
      .catch(() => setHistory([]));
    refreshOps();
  }, []);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const prevent = (event: MouseEvent) => event.preventDefault();
    window.addEventListener('contextmenu', prevent);
    return () => window.removeEventListener('contextmenu', prevent);
  }, []);

  async function refreshOps() {
    try {
      const state = await api.opsState();
      setOps(state);
    } catch {
      setOps(EMPTY_OPS);
    }
  }

  async function refreshHistory() {
    try {
      const result = await api.history();
      setHistory(result.entries);
    } catch {
      setHistory([]);
    }
  }

  async function handleRemoveHistory(path: string) {
    try {
      const result = await api.removeHistory(path);
      setHistory(result.entries);
    } catch (error) {
      setNotice({ type: 'error', text: errorMessage(error) });
    }
  }

  const validation = useMemo(() => {
    const map: Record<number, Record<string, string>> = {};
    if (!skinData) {
      return map;
    }
    for (const block of skinData.blocks) {
      if (block.keys === null) {
        continue;
      }
      const errors: Record<string, string> = {};
      for (const spec of schema) {
        if (spec.name === 'Keys') {
          continue;
        }
        for (const key of concreteKeys(spec, block.keys)) {
          const value =
            drafts[block.keys]?.[key] ?? block.values[key] ?? '';
          const error = validateValue(spec, block.keys, value);
          if (error) {
            errors[key] = error;
          }
        }
      }
      if (Object.keys(errors).length > 0) {
        map[block.keys] = errors;
      }
    }
    return map;
  }, [drafts, schema, skinData]);

  async function openDir(path: string) {
    setBusy(true);
    try {
      const result = await api.openSkinDir(path);
      setBoundDir(result.path);
      setSkins(result.skins);
      setSelectedSkin(null);
      setSkinData(null);
      setActiveKeys(null);
      setDrafts({});
      setDirtyKeys(new Set());
      setStyles({});
    } catch (error) {
      setNotice({ type: 'error', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
    await refreshHistory();
    await refreshOps();
  }

  async function handleBind() {
    setBusy(true);
    try {
      const result = await api.pickSkinDir();
      if (result.cancelled) {
        return;
      }
      if (result.path) {
        await openDir(result.path);
      }
    } catch (error) {
      setNotice({ type: 'error', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleSelectSkin(skin: SkinInfo) {
    if (!skin.hasIni) {
      setNotice({
        type: 'error',
        text: `“${skin.name}”没有 skin.ini，已跳过该皮肤`,
      });
      return;
    }
    setBusy(true);
    try {
      const data = await api.getSkin(skin.path);
      setSelectedSkin(skin);
      setSkinData(data);
      setShowRaw(false);
      const initial: Record<number, Record<string, string>> = {};
      for (const block of data.blocks) {
        if (block.keys !== null) {
          initial[block.keys] = { ...block.values };
        }
      }
      setDrafts(initial);
      setDirtyKeys(new Set());
      const first = data.blocks.find((block) => block.keys !== null)?.keys;
      setActiveKeys(first ?? null);
      const styleResult = await api.getStyles(skin.path);
      setStyles(styleResult.styles);
    } catch (error) {
      setNotice({ type: 'error', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  function handleFieldChange(keys: number, key: string, value: string) {
    setDrafts((current) => {
      const next = { ...current };
      const block = { ...(next[keys] ?? {}) };
      block[key] = value;
      next[keys] = block;
      return next;
    });
    setDirtyKeys((current) => {
      const next = new Set(current);
      next.add(keys);
      return next;
    });
  }

  async function handleSave() {
    if (!skinData || dirtyKeys.size === 0) {
      return;
    }
    setSaving(true);
    try {
      let savedCount = 0;
      for (const keys of [...dirtyKeys].sort((a, b) => a - b)) {
        const original =
          skinData.blocks.find((block) => block.keys === keys)?.values ?? {};
        const draft = drafts[keys] ?? {};
        const updates: Array<{ key: string; value: string }> = [];
        for (const spec of schema) {
          if (spec.name === 'Keys') {
            continue;
          }
          for (const key of concreteKeys(spec, keys)) {
            const value = draft[key] ?? '';
            if ((original[key] ?? '') !== value) {
              updates.push({ key, value });
            }
          }
        }
        if (updates.length > 0) {
          await api.saveMania(skinData.path, keys, updates);
          savedCount += 1;
        }
      }
      const refreshed = await api.getSkin(skinData.path);
      setSkinData(refreshed);
      const initial: Record<number, Record<string, string>> = {};
      for (const block of refreshed.blocks) {
        if (block.keys !== null) {
          initial[block.keys] = { ...block.values };
        }
      }
      setDrafts(initial);
      setDirtyKeys(new Set());
      setNotice({
        type: 'ok',
        text: `已保存 ${savedCount} 个键数模块，原文件备份为 skin.ini.bak；若 osu! 正在运行，按 Ctrl+Shift+Alt+S 刷新皮肤`,
      });
    } catch (error) {
      setNotice({ type: 'error', text: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  async function handleRevert() {
    if (!skinData) {
      return;
    }
    try {
      const refreshed = await api.getSkin(skinData.path);
      setSkinData(refreshed);
      const initial: Record<number, Record<string, string>> = {};
      for (const block of refreshed.blocks) {
        if (block.keys !== null) {
          initial[block.keys] = { ...block.values };
        }
      }
      setDrafts(initial);
      setDirtyKeys(new Set());
    } catch (error) {
      setNotice({ type: 'error', text: errorMessage(error) });
    }
  }

  async function handleSaveStyle(keys: number, name: string) {
    if (!skinData) {
      return;
    }
    const block = skinData.blocks.find((item) => item.keys === keys);
    if (!block) {
      return;
    }
    const values: Record<string, string> = {};
    for (const spec of schema) {
      if (spec.name === 'Keys') {
        continue;
      }
      for (const key of concreteKeys(spec, keys)) {
        values[key] = drafts[keys]?.[key] ?? block.values[key] ?? '';
      }
    }
    try {
      const result = await api.saveStyle(skinData.path, keys, name, values);
      setStyles(result.styles);
      setNotice({
        type: 'ok',
        text: `已保存样式“${name}”到 skin.styles.json`,
      });
    } catch (error) {
      setNotice({ type: 'error', text: errorMessage(error) });
    }
  }

  function handleApplyStyle(keys: number, style: SkinStyle) {
    const next: Record<string, string> = {};
    for (const spec of schema) {
      if (spec.name === 'Keys') {
        continue;
      }
      for (const key of concreteKeys(spec, keys)) {
        next[key] = style.values[key] ?? '';
      }
    }
    const block = skinData?.blocks.find((item) => item.keys === keys);
    const original = block?.values ?? {};
    const current = drafts[keys] ?? {};
    const hasDiff = schema.some((spec) => {
      if (spec.name === 'Keys') {
        return false;
      }
      return concreteKeys(spec, keys).some(
        (key) =>
          (next[key] ?? '') !== (current[key] ?? original[key] ?? ''),
      );
    });
    if (!hasDiff) {
      setNotice({
        type: 'warn',
        text: `样式“${style.name}”与当前配置一致，无需保存`,
      });
      return;
    }
    setDrafts((current) => ({ ...current, [keys]: next }));
    setDirtyKeys((current) => {
      const updated = new Set(current);
      updated.add(keys);
      return updated;
    });
    setNotice({
      type: 'ok',
      text: `已载入样式“${style.name}”，点击保存写入 skin.ini`,
    });
  }

  async function handleUpdateStyle(keys: number, name: string) {
    if (!skinData) {
      return;
    }
    const block = skinData.blocks.find((item) => item.keys === keys);
    if (!block) {
      return;
    }
    const values: Record<string, string> = {};
    for (const spec of schema) {
      if (spec.name === 'Keys') {
        continue;
      }
      for (const key of concreteKeys(spec, keys)) {
        values[key] = drafts[keys]?.[key] ?? block.values[key] ?? '';
      }
    }
    try {
      const result = await api.saveStyle(skinData.path, keys, name, values);
      setStyles(result.styles);
      setNotice({ type: 'ok', text: `已更新样式“${name}”` });
    } catch (error) {
      setNotice({ type: 'error', text: errorMessage(error) });
    }
  }

  async function handleRenameStyle(
    keys: number,
    oldName: string,
    newName: string,
  ) {
    if (!skinData) {
      return;
    }
    try {
      const result = await api.renameStyle(
        skinData.path,
        keys,
        oldName,
        newName,
      );
      setStyles(result.styles);
      setNotice({ type: 'ok', text: `样式已重命名为“${newName}”` });
    } catch (error) {
      setNotice({ type: 'error', text: errorMessage(error) });
    }
  }

  async function handleDeleteStyle(keys: number, name: string) {
    if (!skinData) {
      return;
    }
    try {
      const result = await api.deleteStyle(skinData.path, keys, name);
      setStyles(result.styles);
      setNotice({ type: 'ok', text: `已删除样式“${name}”` });
    } catch (error) {
      setNotice({ type: 'error', text: errorMessage(error) });
    }
  }

  function askClone(skin: SkinInfo) {
    setRenameValue('');
    setModal({ kind: 'clone', skin });
  }

  function askRename(skin: SkinInfo) {
    setRenameValue(skin.name);
    setModal({ kind: 'rename', skin });
  }

  function askDelete(skin: SkinInfo) {
    setRenameValue('');
    setModal({ kind: 'delete', skin });
  }

  async function confirmModal() {
    if (!modal) {
      return;
    }
    const skin = modal.skin;
    const kind = modal.kind;
    if (kind === 'rename' && !renameValue.trim()) {
      setNotice({ type: 'error', text: '名称不能为空' });
      return;
    }
    setBusy(true);
    try {
      if (kind === 'clone') {
        const result = await api.cloneSkin(skin.path);
        setNotice({ type: 'ok', text: `已克隆为“${result.name}”` });
      } else if (kind === 'rename') {
        const result = await api.renameSkin(skin.path, renameValue.trim());
        setNotice({ type: 'ok', text: `已重命名为“${result.name}”` });
      } else {
        await api.deleteSkin(skin.path);
        setNotice({
          type: 'ok',
          text: `“${skin.name}”已移入回收站`,
        });
      }
      setModal(null);
    } catch (error) {
      setNotice({ type: 'error', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
    if (boundDir) {
      await openDir(boundDir);
    }
    await refreshOps();
  }

  async function handleUndo() {
    setBusy(true);
    try {
      await api.undoOps();
    } catch (error) {
      setNotice({ type: 'error', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
    if (boundDir) {
      await openDir(boundDir);
    }
    await refreshOps();
  }

  async function handleRedo() {
    setBusy(true);
    try {
      await api.redoOps();
    } catch (error) {
      setNotice({ type: 'error', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
    if (boundDir) {
      await openDir(boundDir);
    }
    await refreshOps();
  }

  const modalTitle = modal
    ? modal.kind === 'clone'
      ? '确认克隆'
      : modal.kind === 'rename'
        ? '重命名皮肤'
        : '确认删除'
    : '';

  const modalMessage = modal
    ? modal.kind === 'clone'
      ? `确认克隆皮肤“${modal.skin.name}”？将复制整个皮肤文件夹。`
      : modal.kind === 'rename'
        ? `为“${modal.skin.name}”输入新的文件夹名称：`
        : `确认删除皮肤“${modal.skin.name}”？文件夹将移动到回收站，可以撤销。`
    : '';

  return (
    <div className="app" onContextMenu={(event) => event.preventDefault()}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">
            <Music4 size={18} />
          </span>
          <span className="brand-name">osu!mania 皮肤编辑器</span>
          <span className="watermark">Powered by Ulazis</span>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className="ghost"
            disabled={!ops.canUndo || busy}
            title={ops.undoLabel || '撤销'}
            onClick={handleUndo}
          >
            <Undo2 size={15} />
            撤销
          </button>
          <button
            type="button"
            className="ghost"
            disabled={!ops.canRedo || busy}
            title={ops.redoLabel || '重做'}
            onClick={handleRedo}
          >
            <Redo2 size={15} />
            重做
          </button>
          {boundDir && (
            <button
              type="button"
              className="ghost"
              disabled={busy || !boundDir}
              onClick={() => openDir(boundDir)}
            >
              <RefreshCw size={15} />
              刷新
            </button>
          )}
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={handleBind}
          >
            <FolderOpen size={15} />
            {boundDir ? '更换皮肤目录' : '绑定 osu! 皮肤目录'}
          </button>
        </div>
      </header>

      {backendOk === false && (
        <div className="backend-banner">
          <AlertTriangle size={15} />
          无法连接编辑器后端服务，请确认 ManiaSkinEditor.exe 正在运行
        </div>
      )}

      {!boundDir ? (
        <main className="welcome">
          <div className="welcome-panel">
            <span className="welcome-icon">
              <Music4 size={34} />
            </span>
            <h1>osu!mania 皮肤 skin.ini 编辑器</h1>
            <p>绑定 osu! 的 Skins 目录，选择皮肤后按键数模块编辑 [Mania] 参数。</p>
            <button
              type="button"
              className="primary large"
              disabled={busy}
              onClick={handleBind}
            >
              <FolderOpen size={17} />
              绑定 osu! 皮肤目录
            </button>
            {history.length > 0 && (
              <div className="history-block">
                <div className="history-title">最近使用的目录</div>
                <div className="history-list">
                  {history.map((entry) => (
                    <div
                      key={entry.path}
                      className="history-item"
                      title={entry.path}
                    >
                      <button
                        type="button"
                        className="history-open"
                        onClick={() => openDir(entry.path)}
                      >
                        <span className="history-path">{entry.path}</span>
                        <span className="history-time">{entry.lastUsed}</span>
                      </button>
                      <button
                        type="button"
                        className="history-remove"
                        title="删除该历史记录"
                        onClick={() => handleRemoveHistory(entry.path)}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </main>
      ) : (
        <div className="workspace">
          <SkinSidebar
            skins={skins}
            selectedPath={selectedSkin?.path ?? null}
            onSelect={handleSelectSkin}
            onClone={askClone}
            onRename={askRename}
            onDelete={askDelete}
          />
          <main className="main">
            {skinData && selectedSkin ? (
              <EditorPane
                schema={schema}
                skinData={skinData}
                skinName={selectedSkin.name}
                activeKeys={activeKeys}
                drafts={drafts}
                dirtyKeys={dirtyKeys}
                validation={validation}
                styles={styles}
                showRaw={showRaw}
                saving={saving}
                onSelectKeys={setActiveKeys}
                onFieldChange={handleFieldChange}
                onSave={handleSave}
                onRevert={handleRevert}
                onToggleRaw={() => setShowRaw((current) => !current)}
                onOpenNoodleTool={() => setNoodleOpen(true)}
                onSaveStyle={handleSaveStyle}
                onApplyStyle={handleApplyStyle}
                onUpdateStyle={handleUpdateStyle}
                onRenameStyle={handleRenameStyle}
                onDeleteStyle={handleDeleteStyle}
              />
            ) : (
              <div className="empty-state main-empty">
                <FolderOpen size={26} />
                <span>从左侧选择一个皮肤开始编辑</span>
              </div>
            )}
          </main>
        </div>
      )}

      {notice && (
        <div className={`toast ${notice.type}`}>
          {notice.type === 'ok' ? (
            <CheckCircle2 size={16} />
          ) : (
            <AlertTriangle size={16} />
          )}
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>{modalTitle}</h3>
            <p>{modalMessage}</p>
            {modal.kind === 'rename' && (
              <input
                className="modal-input"
                value={renameValue}
                autoFocus
                onChange={(event) => setRenameValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    confirmModal();
                  } else if (event.key === 'Escape') {
                    setModal(null);
                  }
                }}
              />
            )}
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setModal(null)}>
                取消
              </button>
              <button
                type="button"
                className="primary"
                disabled={
                  busy || (modal.kind === 'rename' && !renameValue.trim())
                }
                onClick={confirmModal}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {noodleOpen && skinData && (
        <NoodleTool
          skinPath={skinData.path}
          onClose={() => setNoodleOpen(false)}
          notify={(type, text) => setNotice({ type, text })}
        />
      )}
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
