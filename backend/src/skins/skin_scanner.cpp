#include "skins/skin_scanner.h"

#include <algorithm>
#include <fstream>
#include <sstream>

#include "ini/ini_document.h"

namespace mania {

std::string pathToUtf8(const std::filesystem::path& path) {
  auto text = path.u8string();
  return std::string(reinterpret_cast<const char*>(text.data()), text.size());
}

std::filesystem::path pathFromUtf8(std::string_view text) {
  return std::filesystem::path(
      std::u8string(reinterpret_cast<const char8_t*>(text.data()), text.size()));
}

namespace {

std::string readFileBinary(const std::filesystem::path& path) {
  std::ifstream stream(path, std::ios::binary);
  if (!stream) {
    return {};
  }
  std::ostringstream buffer;
  buffer << stream.rdbuf();
  return buffer.str();
}

}  // namespace

bool isPathWithinRoot(const std::filesystem::path& root,
                      const std::filesystem::path& candidate) {
  std::error_code ec;
  auto canonicalRoot = std::filesystem::weakly_canonical(root, ec);
  if (ec) {
    return false;
  }
  auto canonicalCandidate =
      std::filesystem::weakly_canonical(candidate, ec);
  if (ec) {
    auto absolute =
        std::filesystem::absolute(candidate, ec).lexically_normal();
    if (ec) {
      return false;
    }
    canonicalCandidate = absolute;
  }
  auto relative = canonicalCandidate.lexically_relative(canonicalRoot);
  if (relative.empty()) {
    return true;
  }
  return relative.begin() != relative.end() && *relative.begin() != "..";
}

std::optional<std::filesystem::path> resolveWithinRoot(
    const std::filesystem::path& root, std::string_view relative) {
  std::filesystem::path rel(pathFromUtf8(relative));
  if (rel.is_absolute()) {
    return std::nullopt;
  }
  auto candidate = root / rel;
  if (!isPathWithinRoot(root, candidate)) {
    return std::nullopt;
  }
  return candidate.lexically_normal();
}

std::vector<SkinInfo> scanSkins(const std::filesystem::path& root) {
  std::vector<SkinInfo> skins;
  std::error_code ec;
  auto iterator = std::filesystem::directory_iterator(root, ec);
  if (ec) {
    return skins;
  }
  for (const auto& entry : iterator) {
    std::error_code entryEc;
    if (!entry.is_directory(entryEc) || entryEc) {
      continue;
    }
    SkinInfo info;
    info.name = pathToUtf8(entry.path().filename());
    info.path = pathToUtf8(entry.path());

    auto iniPath = entry.path() / "skin.ini";
    std::error_code iniEc;
    if (!std::filesystem::is_regular_file(iniPath, iniEc)) {
      skins.push_back(std::move(info));
      continue;
    }
    info.hasIni = true;
    auto text = readFileBinary(iniPath);
    auto document = IniDocument::parse(text);
    if (!document) {
      info.error = "skin.ini 解析失败";
      skins.push_back(std::move(info));
      continue;
    }
    for (const auto& block : document->maniaBlocks()) {
      if (block.keys) {
        info.keys.push_back(*block.keys);
      }
    }
    std::sort(info.keys.begin(), info.keys.end());
    info.keys.erase(std::unique(info.keys.begin(), info.keys.end()),
                    info.keys.end());
    skins.push_back(std::move(info));
  }
  return skins;
}

}  // namespace mania
