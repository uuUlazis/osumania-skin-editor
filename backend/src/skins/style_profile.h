#pragma once

#include <filesystem>
#include <string>

#include <json.hpp>

namespace mania {

// All skins share one merged style profile stored in the bound Skins root
// directory. Skin keys are the skin folder names.
class StyleProfile {
 public:
  static std::filesystem::path profilePath(
      const std::filesystem::path& skinDir);

  // Styles for one skin: {"4": [{"name","values"}, ...]}. Empty on error.
  static nlohmann::json load(const std::filesystem::path& skinDir);

  // Summary of style names per key count for one skin.
  static nlohmann::json summary(const std::filesystem::path& skinDir);

  static bool saveStyle(const std::filesystem::path& skinDir, int keys,
                        const std::string& name,
                        const nlohmann::json& values, std::string& error);
  static bool deleteStyle(const std::filesystem::path& skinDir, int keys,
                          const std::string& name, std::string& error);
  static bool renameStyle(const std::filesystem::path& skinDir, int keys,
                          const std::string& oldName,
                          const std::string& newName, std::string& error);

  // Folder-operation helpers (parent is the Skins root).
  static bool copySkinStyles(const std::filesystem::path& parent,
                             const std::string& fromName,
                             const std::string& toName, std::string& error);
  static bool renameSkinStyles(const std::filesystem::path& parent,
                               const std::string& oldName,
                               const std::string& newName,
                               std::string& error);
  static nlohmann::json takeSkinStyles(const std::filesystem::path& parent,
                                       const std::string& name);
  static bool restoreSkinStyles(const std::filesystem::path& parent,
                                const std::string& name,
                                const nlohmann::json& styles,
                                std::string& error);
};

}  // namespace mania
