#include "skins/skin_ops.h"

#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>

#include <algorithm>
#include <cctype>
#include <ctime>
#include <system_error>

#include <json.hpp>

#include "skins/skin_scanner.h"
#include "skins/style_profile.h"

namespace mania {

using nlohmann::json;

namespace {

bool isValidFolderName(const std::string& name) {
  if (name.empty() || name == "." || name == "..") {
    return false;
  }
  const std::string forbidden = "\\/:*?\"<>|";
  for (char c : name) {
    if (forbidden.find(c) != std::string::npos ||
        std::iscntrl(static_cast<unsigned char>(c))) {
      return false;
    }
  }
  return true;
}

bool moveToRecycleBin(const std::filesystem::path& path) {
  std::wstring source = path.wstring() + L'\0';
  SHFILEOPSTRUCTW operation{};
  operation.wFunc = FO_DELETE;
  operation.pFrom = source.c_str();
  operation.fFlags = FOF_ALLOWUNDO | FOF_SILENT | FOF_NOCONFIRMATION |
                     FOF_NOERRORUI | FOF_NOCONFIRMMKDIR;
  return SHFileOperationW(&operation) == 0;
}

std::string opKindName(SkinOpKind kind) {
  switch (kind) {
    case SkinOpKind::Clone:
      return "克隆";
    case SkinOpKind::Rename:
      return "重命名";
    case SkinOpKind::Delete:
      return "删除";
  }
  return "操作";
}

bool copyDirectoryRecursive(const std::filesystem::path& source,
                            const std::filesystem::path& target,
                            std::string& error) {
  std::error_code ec;
  std::filesystem::create_directories(target, ec);
  if (ec) {
    error = "创建目录失败：" + ec.message();
    return false;
  }
  std::filesystem::copy(source, target,
                        std::filesystem::copy_options::recursive |
                            std::filesystem::copy_options::overwrite_existing,
                        ec);
  if (ec) {
    error = "复制目录失败：" + ec.message();
    return false;
  }
  return true;
}

}  // namespace

std::filesystem::path SkinOpsManager::backupRoot() {
  wchar_t buffer[MAX_PATH]{};
  if (SHGetFolderPathW(nullptr, CSIDL_LOCAL_APPDATA, nullptr,
                       SHGFP_TYPE_CURRENT, buffer) != S_OK) {
    return std::filesystem::temp_directory_path() / L"ManiaSkinEditorUndo";
  }
  return std::filesystem::path(buffer) / L"ManiaSkinEditor" / L"undo";
}

void SkinOpsManager::clearRedoLocked() {
  for (const auto& op : redo_) {
    if (!op.backupPath.empty()) {
      std::error_code ec;
      std::filesystem::remove_all(pathFromUtf8(op.backupPath), ec);
    }
  }
  redo_.clear();
}

bool SkinOpsManager::clone(const std::filesystem::path& skinDir,
                           std::string& newName, std::string& error) {
  std::error_code ec;
  if (!std::filesystem::is_directory(skinDir, ec) || ec) {
    error = "path 不是有效皮肤目录";
    return false;
  }
  auto parent = skinDir.parent_path();
  std::string baseName = pathToUtf8(skinDir.filename());
  std::string candidate = baseName + " (clone)";
  int suffix = 2;
  while (std::filesystem::exists(parent / pathFromUtf8(candidate), ec)) {
    candidate = baseName + " (clone " + std::to_string(suffix) + ")";
    ++suffix;
  }
  auto target = parent / pathFromUtf8(candidate);
  if (!copyDirectoryRecursive(skinDir, target, error)) {
    return false;
  }
  if (!StyleProfile::copySkinStyles(parent, baseName, candidate, error)) {
    std::error_code cleanupEc;
    std::filesystem::remove_all(target, cleanupEc);
    return false;
  }

  std::lock_guard lock(mutex_);
  clearRedoLocked();
  SkinOp op;
  op.id = nextId_++;
  op.kind = SkinOpKind::Clone;
  op.parentPath = pathToUtf8(parent);
  op.oldName = baseName;
  op.newName = candidate;
  undo_.push_back(std::move(op));
  newName = candidate;
  return true;
}

bool SkinOpsManager::rename(const std::filesystem::path& skinDir,
                            const std::string& newName,
                            std::string& newPath, std::string& error) {
  if (!isValidFolderName(newName)) {
    error = "新名称包含非法字符";
    return false;
  }
  auto parent = skinDir.parent_path();
  std::string oldName = pathToUtf8(skinDir.filename());
  if (oldName == newName) {
    error = "新名称与当前名称相同";
    return false;
  }
  auto target = parent / pathFromUtf8(newName);
  std::error_code ec;
  if (std::filesystem::exists(target, ec)) {
    error = "同名皮肤已存在";
    return false;
  }
  std::filesystem::rename(skinDir, target, ec);
  if (ec) {
    error = "重命名失败：" + ec.message();
    return false;
  }
  if (!StyleProfile::renameSkinStyles(parent, oldName, newName, error)) {
    std::error_code rollbackEc;
    std::filesystem::rename(target, skinDir, rollbackEc);
    return false;
  }

  std::lock_guard lock(mutex_);
  clearRedoLocked();
  SkinOp op;
  op.id = nextId_++;
  op.kind = SkinOpKind::Rename;
  op.parentPath = pathToUtf8(parent);
  op.oldName = oldName;
  op.newName = newName;
  undo_.push_back(std::move(op));
  newPath = pathToUtf8(target);
  return true;
}

bool SkinOpsManager::removeToRecycleBin(
    const std::filesystem::path& skinDir, std::string& error) {
  std::error_code ec;
  if (!std::filesystem::is_directory(skinDir, ec) || ec) {
    error = "path 不是有效皮肤目录";
    return false;
  }
  auto parent = skinDir.parent_path();
  std::string name = pathToUtf8(skinDir.filename());

  int opId = 0;
  {
    std::lock_guard lock(mutex_);
    opId = nextId_++;
  }
  json removedStyles = StyleProfile::takeSkinStyles(parent, name);
  auto backup = backupRoot() / (std::to_string(opId) + "_" + name);
  if (!copyDirectoryRecursive(skinDir, backup, error)) {
    return false;
  }
  if (!moveToRecycleBin(skinDir)) {
    std::error_code cleanupEc;
    std::filesystem::remove_all(backup, cleanupEc);
    error = "移动到回收站失败";
    return false;
  }

  std::lock_guard lock(mutex_);
  clearRedoLocked();
  SkinOp op;
  op.id = opId;
  op.kind = SkinOpKind::Delete;
  op.parentPath = pathToUtf8(parent);
  op.oldName = name;
  op.backupPath = pathToUtf8(backup);
  op.stylesJson = removedStyles.dump();
  undo_.push_back(std::move(op));
  return true;
}

bool SkinOpsManager::undo(std::string& error) {
  std::lock_guard lock(mutex_);
  if (undo_.empty()) {
    error = "没有可撤销的操作";
    return false;
  }
  SkinOp op = undo_.back();
  auto parent = pathFromUtf8(op.parentPath);
  bool ok = false;
  switch (op.kind) {
    case SkinOpKind::Clone: {
      auto target = parent / pathFromUtf8(op.newName);
      std::error_code ec;
      if (std::filesystem::exists(target, ec)) {
        std::filesystem::remove_all(target, ec);
      }
      ok = !ec;
      if (ok) {
        StyleProfile::takeSkinStyles(parent, op.newName);
      }
      break;
    }
    case SkinOpKind::Rename: {
      auto oldPath = parent / pathFromUtf8(op.oldName);
      auto newPath = parent / pathFromUtf8(op.newName);
      std::error_code ec;
      std::filesystem::rename(newPath, oldPath, ec);
      ok = !ec;
      if (ok) {
        std::string profileError;
        ok = StyleProfile::renameSkinStyles(parent, op.newName, op.oldName,
                                            profileError);
      }
      break;
    }
    case SkinOpKind::Delete: {
      auto backup = pathFromUtf8(op.backupPath);
      auto target = parent / pathFromUtf8(op.oldName);
      std::error_code ec;
      if (std::filesystem::exists(backup, ec) &&
          std::filesystem::is_directory(backup, ec)) {
        std::filesystem::copy(backup, target,
                              std::filesystem::copy_options::recursive |
                                  std::filesystem::copy_options::
                                      overwrite_existing,
                              ec);
      } else {
        ec = std::make_error_code(std::errc::no_such_file_or_directory);
      }
      ok = !ec;
      if (ok) {
        std::string profileError;
        json styles = json::object();
        if (!op.stylesJson.empty()) {
          try {
            styles = json::parse(op.stylesJson);
          } catch (...) {
            styles = json::object();
          }
        }
        ok = StyleProfile::restoreSkinStyles(parent, op.oldName, styles,
                                             profileError);
      }
      break;
    }
  }
  if (!ok) {
    error = "撤销失败";
    return false;
  }
  redo_.push_back(op);
  undo_.pop_back();
  return true;
}

bool SkinOpsManager::redo(std::string& error) {
  std::lock_guard lock(mutex_);
  if (redo_.empty()) {
    error = "没有可重做的操作";
    return false;
  }
  SkinOp op = redo_.back();
  auto parent = pathFromUtf8(op.parentPath);
  bool ok = false;
  switch (op.kind) {
    case SkinOpKind::Clone: {
      auto source = parent / pathFromUtf8(op.oldName);
      auto target = parent / pathFromUtf8(op.newName);
      std::string copyError;
      ok = copyDirectoryRecursive(source, target, copyError);
      if (ok) {
        std::string profileError;
        ok = StyleProfile::copySkinStyles(parent, op.oldName, op.newName,
                                          profileError);
      }
      break;
    }
    case SkinOpKind::Rename: {
      auto oldPath = parent / pathFromUtf8(op.oldName);
      auto newPath = parent / pathFromUtf8(op.newName);
      std::error_code ec;
      std::filesystem::rename(oldPath, newPath, ec);
      ok = !ec;
      if (ok) {
        std::string profileError;
        ok = StyleProfile::renameSkinStyles(parent, op.oldName, op.newName,
                                            profileError);
      }
      break;
    }
    case SkinOpKind::Delete: {
      auto target = parent / pathFromUtf8(op.oldName);
      ok = moveToRecycleBin(target);
      if (ok) {
        StyleProfile::takeSkinStyles(parent, op.oldName);
      }
      break;
    }
  }
  if (!ok) {
    error = "重做失败";
    return false;
  }
  undo_.push_back(op);
  redo_.pop_back();
  return true;
}

SkinOpsState SkinOpsManager::state() const {
  std::lock_guard lock(mutex_);
  SkinOpsState out;
  if (!undo_.empty()) {
    out.canUndo = true;
    const SkinOp& op = undo_.back();
    const std::string& name =
        op.kind == SkinOpKind::Delete ? op.oldName : op.newName;
    out.undoLabel = "撤销" + opKindName(op.kind) + " " + name;
  }
  if (!redo_.empty()) {
    out.canRedo = true;
    const SkinOp& op = redo_.back();
    const std::string& name =
        op.kind == SkinOpKind::Delete ? op.oldName : op.newName;
    out.redoLabel = "重做" + opKindName(op.kind) + " " + name;
  }
  return out;
}

}  // namespace mania
