#pragma once

#include <filesystem>
#include <string>

#include <json.hpp>

namespace mania {

class HistoryStore {
 public:
  // Returns recent bound skin directories: [{"path": "...", "lastUsed": "..."}]
  static nlohmann::json load();

  // Records a successfully bound skin directory (most recent first).
  static void record(const std::filesystem::path& path);

  static void remove(const std::string& path);

  static void clear();

 private:
  static std::filesystem::path historyPath();
};

}  // namespace mania
