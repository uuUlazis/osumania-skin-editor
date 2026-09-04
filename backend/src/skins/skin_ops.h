#pragma once

#include <filesystem>
#include <mutex>
#include <string>
#include <vector>

namespace mania {

enum class SkinOpKind { Clone, Rename, Delete };

struct SkinOp {
  int id = 0;
  SkinOpKind kind = SkinOpKind::Clone;
  std::string parentPath;  // UTF-8 parent directory
  std::string oldName;     // original folder name
  std::string newName;     // clone target / rename target
  std::string backupPath;  // UTF-8 backup folder (delete ops only)
  std::string stylesJson;  // merged profile styles removed by a delete op
};

struct SkinOpsState {
  bool canUndo = false;
  bool canRedo = false;
  std::string undoLabel;
  std::string redoLabel;
};

class SkinOpsManager {
 public:
  bool clone(const std::filesystem::path& skinDir, std::string& newName,
             std::string& error);
  bool rename(const std::filesystem::path& skinDir,
              const std::string& newName, std::string& newPath,
              std::string& error);
  bool removeToRecycleBin(const std::filesystem::path& skinDir,
                          std::string& error);
  bool undo(std::string& error);
  bool redo(std::string& error);
  SkinOpsState state() const;

 private:
  static std::filesystem::path backupRoot();
  void clearRedoLocked();

  mutable std::mutex mutex_;
  std::vector<SkinOp> undo_;
  std::vector<SkinOp> redo_;
  int nextId_ = 1;
};

}  // namespace mania
