import { Copy, Pencil, Trash2 } from 'lucide-react';
import type { SkinInfo } from '../api/client';

interface SkinSidebarProps {
  skins: SkinInfo[];
  selectedPath: string | null;
  onSelect: (skin: SkinInfo) => void;
  onClone: (skin: SkinInfo) => void;
  onRename: (skin: SkinInfo) => void;
  onDelete: (skin: SkinInfo) => void;
}

export function SkinSidebar({
  skins,
  selectedPath,
  onSelect,
  onClone,
  onRename,
  onDelete,
}: SkinSidebarProps) {
  return (
    <aside className="skin-sidebar">
      <div className="sidebar-head">
        <span>皮肤列表</span>
        <span className="count">{skins.length}</span>
      </div>
      <div className="dir-hint">对皮肤目录的修改需要重启 osu! 来更新</div>
      <div className="skin-list">
        {skins.length === 0 && (
          <div className="empty-list">该目录下没有皮肤文件夹</div>
        )}
        {skins.map((skin) => (
          <div
            key={skin.path}
            className={`skin-item ${selectedPath === skin.path ? 'active' : ''} ${
              skin.hasIni ? '' : 'missing'
            }`}
            title={skin.path}
          >
            <button
              type="button"
              className="skin-select"
              disabled={!skin.hasIni}
              onClick={() => onSelect(skin)}
            >
              <span className="skin-name">{skin.name}</span>
              <span className="skin-meta">
                {skin.hasIni
                  ? skin.keys.map((key) => `${key}K`).join(' ')
                  : '缺少 skin.ini'}
                {skin.styleCount ? ` · ${skin.styleCount} 样式` : ''}
              </span>
            </button>
            <div className="skin-actions">
              {skin.hasIni && (
                <>
                  <button
                    type="button"
                    className="skin-action"
                    title="克隆该皮肤"
                    onClick={() => onClone(skin)}
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    type="button"
                    className="skin-action"
                    title="重命名该皮肤"
                    onClick={() => onRename(skin)}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="skin-action danger"
                    title="删除该皮肤（移入回收站）"
                    onClick={() => onDelete(skin)}
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
