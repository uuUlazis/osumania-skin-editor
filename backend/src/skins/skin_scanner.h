#pragma once

#include <filesystem>
#include <optional>
#include <string>
#include <vector>

namespace mania {

struct SkinInfo {
  std::string name;
  std::string path;
  bool hasIni = false;
  std::vector<int> keys;
  std::string error;
};

std::vector<SkinInfo> scanSkins(const std::filesystem::path& root);

// Path safety helpers. All file operations must go through these.
bool isPathWithinRoot(const std::filesystem::path& root,
                      const std::filesystem::path& candidate);
std::optional<std::filesystem::path> resolveWithinRoot(
    const std::filesystem::path& root, std::string_view relative);

std::string pathToUtf8(const std::filesystem::path& path);
std::filesystem::path pathFromUtf8(std::string_view text);

}  // namespace mania
