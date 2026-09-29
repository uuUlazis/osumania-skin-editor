import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  ImagePlus,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import type { FieldSpec, SkinData, SkinStyle, StyleMap } from '../api/client';
import { FieldControl, concreteKeys } from './fields';
import { KeyTabs } from './KeyTabs';
import { SkinPreview } from './SkinPreview';

const GROUP_ORDER = [
  'common',
  'layout',
  'image',
  'stage',
  'flip',
  'hold',
  'color',
];

const GROUP_LABELS: Record<string, string> = {
  common: '常用数据',
  layout: '布局与判定',
  stage: '特殊键与舞台',
  flip: '上下翻转',
  hold: '长按样式',
  color: '颜色',
  image: '图像',
};

interface EditorPaneProps {
  schema: FieldSpec[];
  skinData: SkinData;
  skinName: string;
  activeKeys: number | null;
  drafts: Record<number, Record<string, string>>;
  dirtyKeys: Set<number>;
  validation: Record<number, Record<string, string>>;
  styles: StyleMap;
  showRaw: boolean;
  saving: boolean;
  onSelectKeys: (keys: number) => void;
  onFieldChange: (keys: number, key: string, value: string) => void;
  onSave: () => void;
  onRevert: () => void;
  onToggleRaw: () => void;
  onOpenNoodleTool: () => void;
  onSaveStyle: (keys: number, name: string) => void;
  onApplyStyle: (keys: number, style: SkinStyle) => void;
  onUpdateStyle: (keys: number, name: string) => void;
  onRenameStyle: (keys: number, oldName: string, newName: string) => void;
  onDeleteStyle: (keys: number, name: string) => void;
}

function displayKeyName(spec: FieldSpec): string {
  return spec.perColumn ? `${spec.name}#${spec.indexSuffix}` : spec.name;
}

function MissingHint({ present, value }: { present: boolean; value: string }) {
  if (present || value !== '') {
    return null;
  }
  return <span className="missing-hint">皮肤未设置</span>;
}

export function EditorPane({
  schema,
  skinData,
  skinName,
  activeKeys,
  drafts,
  dirtyKeys,
  validation,
  styles,
  showRaw,
  saving,
  onSelectKeys,
  onFieldChange,
  onSave,
  onRevert,
  onToggleRaw,
  onOpenNoodleTool,
  onSaveStyle,
  onApplyStyle,
  onUpdateStyle,
  onRenameStyle,
  onDeleteStyle,
}: EditorPaneProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedStyle, setSelectedStyle] = useState('');
  const [styleInput, setStyleInput] = useState('');
  const [creatingNew, setCreatingNew] = useState(false);
  const [previewWidth, setPreviewWidth] = useState<number | null>(() => {
    const stored = window.localStorage.getItem('mania.previewWidth');
    const parsed = stored ? Number(stored) : Number.NaN;
    return Number.isFinite(parsed) && parsed >= 320 ? parsed : null;
  });
  const block = skinData.blocks.find((item) => item.keys === activeKeys);
  const allKeys = skinData.blocks
    .map((item) => item.keys)
    .filter((key): key is number => key !== null)
    .sort((a, b) => a - b);
  const blockErrors = activeKeys !== null ? validation[activeKeys] ?? {} : {};
  const hasErrors = [...dirtyKeys].some((keys) => {
    const errors = validation[keys] ?? {};
    const errorKeys = Object.keys(errors);
    if (errorKeys.length === 0) {
      return false;
    }
    const block = skinData.blocks.find((item) => item.keys === keys);
    if (!block) {
      return false;
    }
    const draft = drafts[keys] ?? {};
    return errorKeys.some(
      (key) => (draft[key] ?? '') !== (block.values[key] ?? ''),
    );
  });
  const stylesForKeys =
    activeKeys !== null ? styles[String(activeKeys)] ?? [] : [];
  const groups = GROUP_ORDER.map((group) => ({
    key: group,
    label: GROUP_LABELS[group],
    specs: schema.filter(
      (field) => field.group === group && field.name !== 'Keys',
    ),
  })).filter((group) => group.specs.length > 0);

  const fonts = useMemo(() => {
    const parsed = {
      scorePrefix: 'score',
      comboPrefix: 'combo',
      scoreOverlap: 0,
      comboOverlap: 0,
    };
    let inFonts = false;
    for (const line of (skinData.raw ?? '').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith('[')) {
        inFonts = /^\[fonts\]/i.test(trimmed);
        continue;
      }
      if (!inFonts) {
        continue;
      }
      const match = trimmed.match(/^([A-Za-z]+)\s*:\s*(.*)$/);
      if (!match) {
        continue;
      }
      const key = match[1].toLowerCase();
      const raw = match[2].trim();
      if (key === 'scoreprefix' && raw !== '') {
        parsed.scorePrefix = raw;
      } else if (key === 'comboprefix' && raw !== '') {
        parsed.comboPrefix = raw;
      } else if (key === 'scoreoverlap') {
        parsed.scoreOverlap = Number(raw) || 0;
      } else if (key === 'combooverlap') {
        parsed.comboOverlap = Number(raw) || 0;
      }
    }
    return parsed;
  }, [skinData.raw]);

  const effectiveValues = useMemo(() => {
    const current = skinData.blocks.find((item) => item.keys === activeKeys);
    if (!current || activeKeys === null) {
      return {};
    }
    return { ...current.values, ...(drafts[activeKeys] ?? {}) };
  }, [activeKeys, drafts, skinData]);

  useEffect(() => {
    if (previewWidth !== null) {
      window.localStorage.setItem('mania.previewWidth', String(Math.round(previewWidth)));
    }
  }, [previewWidth]);

  function startPreviewResize(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const pane = event.currentTarget.nextElementSibling as HTMLElement | null;
    const startWidth = pane ? pane.getBoundingClientRect().width : 480;
    const onMove = (moveEvent: MouseEvent) => {
      // 左限界：给左侧皮肤列表(288) + 参数表单(380) 留出空间，预览不能被无限拉宽
      const maxByForm = Math.max(320, window.innerWidth - 288 - 380);
      const next = Math.max(
        320,
        Math.min(maxByForm, startWidth + (startX - moveEvent.clientX)),
      );
      setPreviewWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function toggleGroup(group: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  }

  useEffect(() => {
    if (
      selectedStyle &&
      !stylesForKeys.some((style) => style.name === selectedStyle)
    ) {
      setSelectedStyle('');
    }
  }, [selectedStyle, stylesForKeys]);

  return (
    <section className="editor">
      <header className="editor-head">
        <div className="editor-title">
          <h2>{skinName}</h2>
          <span className="version-chip">
            Version: {skinData.version ?? '未设置'}
          </span>
        </div>
        <KeyTabs
          keys={allKeys}
          active={activeKeys}
          dirty={dirtyKeys}
          onChange={onSelectKeys}
        />
        <div className="editor-actions">
          <button
            type="button"
            className="ghost"
            onClick={onOpenNoodleTool}
          >
            <ImagePlus size={15} />
            面条身工具
          </button>
          <span className="save-hint">
            若 osu! 运行中：Ctrl+Shift+Alt+S 刷新皮肤
          </span>
          <button
            type="button"
            className="ghost"
            disabled={dirtyKeys.size === 0 || saving}
            onClick={onRevert}
          >
            <RotateCcw size={15} />
            还原
          </button>
          <button
            type="button"
            className="primary"
            disabled={dirtyKeys.size === 0 || saving || hasErrors}
            onClick={onSave}
          >
            <Save size={15} />
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </header>

      {activeKeys !== null && (
        <div className="style-bar">
          {stylesForKeys.length === 0 && !creatingNew ? (
            <button
              type="button"
              className="ghost"
              onClick={() => setCreatingNew(true)}
            >
              <Plus size={14} />
              新建样式
            </button>
          ) : (
            <>
              <div className="style-buttons">
                {stylesForKeys.map((style) => (
                  <button
                    key={style.name}
                    type="button"
                    className={`style-pill ${
                      selectedStyle === style.name ? 'active' : ''
                    }`}
                    onClick={() => setSelectedStyle(style.name)}
                  >
                    {style.name}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="ghost"
                disabled={!selectedStyle}
                onClick={() => {
                  const style = stylesForKeys.find(
                    (item) => item.name === selectedStyle,
                  );
                  if (style) {
                    onApplyStyle(activeKeys, style);
                  }
                }}
              >
                <Check size={14} />
                应用
              </button>
              <input
                type="text"
                className="style-input"
                value={styleInput}
                placeholder="输入样式名"
                onChange={(event) => setStyleInput(event.target.value)}
              />
              <button
                type="button"
                className="primary"
                disabled={!styleInput.trim()}
                onClick={() => {
                  onSaveStyle(activeKeys, styleInput.trim());
                  setStyleInput('');
                  setCreatingNew(false);
                }}
              >
                <Save size={14} />
                保存为样式
              </button>
              <button
                type="button"
                className="ghost"
                disabled={!selectedStyle}
                onClick={() => onUpdateStyle(activeKeys, selectedStyle)}
              >
                <RefreshCw size={14} />
                更新样式
              </button>
              <button
                type="button"
                className="ghost"
                disabled={!selectedStyle || !styleInput.trim()}
                onClick={() =>
                  onRenameStyle(activeKeys, selectedStyle, styleInput.trim())
                }
              >
                <Pencil size={14} />
                重命名
              </button>
              <button
                type="button"
                className="ghost danger-text"
                disabled={!selectedStyle}
                onClick={() => onDeleteStyle(activeKeys, selectedStyle)}
              >
                <Trash2 size={14} />
                删除
              </button>
            </>
          )}
          <span className="style-hint">
            样式统一保存在 Skins 根目录的 skin.styles.json
          </span>
        </div>
      )}

      {skinData.warnings.length > 0 && (
        <div className="warning-banner">
          {skinData.warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      )}

      <div className="editor-body">
        <div className="form-scroll">
          {allKeys.length === 0 && (
            <div className="empty-state">
              该 skin.ini 中没有可编辑的 [Mania] 模块
            </div>
          )}
          {allKeys.length > 0 && activeKeys === null && (
            <div className="empty-state">请选择上方的一个键数模块</div>
          )}
          {activeKeys !== null &&
            block &&
            groups.map((group) => {
              const isCollapsed = collapsed.has(group.key);
              return (
                <section className="field-group" key={group.key}>
                  <button
                    type="button"
                    className="group-toggle"
                    onClick={() => toggleGroup(group.key)}
                  >
                    {isCollapsed ? (
                      <ChevronRight size={14} />
                    ) : (
                      <ChevronDown size={14} />
                    )}
                    <h3>{group.label}</h3>
                    <span className="group-count">{group.specs.length}</span>
                  </button>
                  {!isCollapsed && (
                    <div className="group-body">
                      {group.specs.map((spec) => {
                        const concrete = concreteKeys(spec, activeKeys);
                        if (!spec.perColumn) {
                          const key = spec.name;
                          const present =
                            Object.prototype.hasOwnProperty.call(
                              block.values,
                              key,
                            );
                          const value =
                            drafts[activeKeys]?.[key] ?? block.values[key] ?? '';
                          return (
                            <div className="field-row" key={key}>
                              <div className="field-label" title={spec.help}>
                                <span>{spec.label}</span>
                                <div className="label-meta">
                                  <code>{displayKeyName(spec)}</code>
                                  {spec.requiresVersion25 && (
                                    <span className="v25-badge">需 2.5+</span>
                                  )}
                                </div>
                                <MissingHint present={present} value={value} />
                              </div>
                              <div className="field-control">
                                <FieldControl
                                  spec={spec}
                                  keys={activeKeys}
                                  value={value}
                                  onChange={(next) =>
                                    onFieldChange(activeKeys, key, next)
                                  }
                                />
                                {blockErrors[key] && (
                                  <span className="field-error">
                                    {blockErrors[key]}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div
                            className="field-block"
                            key={spec.name + spec.indexSuffix}
                          >
                            <div className="field-label" title={spec.help}>
                              <span>{spec.label}</span>
                              <div className="label-meta">
                                <code>{displayKeyName(spec)}</code>
                                {spec.requiresVersion25 && (
                                  <span className="v25-badge">需 2.5+</span>
                                )}
                              </div>
                            </div>
                            <div className="slot-grid">
                              {concrete.map((key, index) => {
                                const present =
                                  Object.prototype.hasOwnProperty.call(
                                    block.values,
                                    key,
                                  );
                                const value =
                                  drafts[activeKeys]?.[key] ??
                                  block.values[key] ??
                                  '';
                                return (
                                  <div className="slot-cell" key={key}>
                                    <span className="slot-index">
                                      {spec.indexStart + index}
                                      <MissingHint
                                        present={present}
                                        value={value}
                                      />
                                    </span>
                                    <FieldControl
                                      spec={spec}
                                      keys={activeKeys}
                                      value={value}
                                      onChange={(next) =>
                                        onFieldChange(activeKeys, key, next)
                                      }
                                    />
                                    {blockErrors[key] && (
                                      <span className="field-error">
                                        {blockErrors[key]}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
        </div>
        <div
          className="preview-resizer"
          role="separator"
          aria-orientation="vertical"
          title="拖动调整预览宽度（双击恢复默认）"
          onMouseDown={startPreviewResize}
          onDoubleClick={() => setPreviewWidth(null)}
        />
        <SkinPreview
          skinPath={skinData.path}
          skinName={skinName}
          fonts={fonts}
          keys={activeKeys}
          values={effectiveValues}
          version={skinData.version}
          width={previewWidth}
        />
      </div>

      {showRaw && (
        <div className="raw-panel">
          <div className="raw-head">
            <span>skin.ini 原始内容</span>
            <button type="button" className="icon-btn" onClick={onToggleRaw}>
              <FileText size={15} />
              收起
            </button>
          </div>
          <pre>{skinData.raw}</pre>
        </div>
      )}

      {!showRaw && (
        <footer className="editor-footer">
          <button type="button" className="ghost" onClick={onToggleRaw}>
            <FileText size={14} />
            查看原始 skin.ini
          </button>
          <span className="dirty-hint">
            {dirtyKeys.size > 0
              ? `${dirtyKeys.size} 个键数模块有未保存修改`
              : '所有修改已保存'}
          </span>
        </footer>
      )}
    </section>
  );
}
