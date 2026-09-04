#include "app/history_store.h"

#include <windows.h>
#include <shlobj.h>

#include <algorithm>
#include <chrono>
#include <ctime>
#include <fstream>
#include <sstream>

#include "skins/skin_scanner.h"

namespace mania {

namespace {

using nlohmann::json;

constexpr int kMaxEntries = 10;

std::string readFileText(const std::filesystem::path& path) {
  std::ifstream stream(path, std::ios::binary);
  if (!stream) {
    return {};
  }
  std::ostringstream buffer;
  buffer << stream.rdbuf();
  return buffer.str();
}

bool writeFileText(const std::filesystem::path& path,
                   const std::string& text) {
  auto tmp = path;
  tmp += ".tmp";
  std::ofstream tmpStream(tmp, std::ios::binary | std::ios::trunc);
  if (!tmpStream) {
    return false;
  }
  tmpStream.write(text.data(), static_cast<std::streamsize>(text.size()));
  tmpStream.flush();
  tmpStream.close();
  if (!tmpStream) {
    return false;
  }
  return MoveFileExW(tmp.c_str(), path.c_str(),
                     MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) != 0;
}

std::string nowIso() {
  auto now = std::chrono::system_clock::now();
  std::time_t time = std::chrono::system_clock::to_time_t(now);
  std::tm tm{};
  localtime_s(&tm, &time);
  char buffer[32]{};
  std::strftime(buffer, sizeof(buffer), "%Y-%m-%d %H:%M:%S", &tm);
  return buffer;
}

}  // namespace

std::filesystem::path HistoryStore::historyPath() {
  wchar_t buffer[MAX_PATH]{};
  if (SHGetFolderPathW(nullptr, CSIDL_LOCAL_APPDATA, nullptr,
                       SHGFP_TYPE_CURRENT, buffer) != S_OK) {
    return std::filesystem::temp_directory_path() / L"ManiaSkinEditorHistory";
  }
  return std::filesystem::path(buffer) / L"ManiaSkinEditor" / L"history.json";
}

json HistoryStore::load() {
  auto path = historyPath();
  if (!std::filesystem::exists(path)) {
    return json::array();
  }
  json document;
  try {
    document = json::parse(readFileText(path));
  } catch (...) {
    return json::array();
  }
  if (!document.is_object() || !document.contains("entries") ||
      !document["entries"].is_array()) {
    return json::array();
  }
  json out = json::array();
  for (const auto& entry : document["entries"]) {
    if (!entry.is_object() || !entry.contains("path") ||
        !entry["path"].is_string()) {
      continue;
    }
    std::error_code ec;
    if (!std::filesystem::is_directory(
            pathFromUtf8(entry["path"].get<std::string>()), ec) ||
        ec) {
      continue;
    }
    out.push_back(entry);
    if (out.size() >= kMaxEntries) {
      break;
    }
  }
  return out;
}

void HistoryStore::record(const std::filesystem::path& path) {
  auto pathText = pathToUtf8(path);
  std::error_code ec;
  if (!std::filesystem::is_directory(path, ec) || ec) {
    return;
  }

  json document = {{"version", 1}, {"entries", json::array()}};
  auto file = historyPath();
  if (std::filesystem::exists(file)) {
    try {
      auto parsed = json::parse(readFileText(file));
      if (parsed.is_object() && parsed.contains("entries") &&
          parsed["entries"].is_array()) {
        document["entries"] = parsed["entries"];
      }
    } catch (...) {
      document["entries"] = json::array();
    }
  }

  auto& entries = document["entries"];
  entries.erase(
      std::remove_if(entries.begin(), entries.end(),
                     [&](const json& entry) {
                       return entry.is_object() &&
                              entry.value("path", "") == pathText;
                     }),
      entries.end());

  json entry = {{"path", pathText}, {"lastUsed", nowIso()}};
  entries.insert(entries.begin(), std::move(entry));
  while (entries.size() > kMaxEntries) {
    entries.erase(entries.end() - 1);
  }

  std::error_code dirEc;
  std::filesystem::create_directories(file.parent_path(), dirEc);
  if (dirEc) {
    return;
  }
  writeFileText(file, document.dump(2));
}

void HistoryStore::remove(const std::string& path) {
  auto file = historyPath();
  if (!std::filesystem::exists(file)) {
    return;
  }
  json document;
  try {
    document = json::parse(readFileText(file));
  } catch (...) {
    return;
  }
  if (!document.is_object() || !document.contains("entries") ||
      !document["entries"].is_array()) {
    return;
  }
  auto& entries = document["entries"];
  entries.erase(
      std::remove_if(entries.begin(), entries.end(),
                     [&](const json& entry) {
                       return entry.is_object() &&
                              entry.value("path", "") == path;
                     }),
      entries.end());
  writeFileText(file, document.dump(2));
}

void HistoryStore::clear() {
  std::error_code ec;
  std::filesystem::remove(historyPath(), ec);
}

}  // namespace mania
