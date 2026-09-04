#include "skins/style_profile.h"

#include <windows.h>

#include <algorithm>
#include <fstream>
#include <mutex>
#include <sstream>

#include "ini/ini_document.h"
#include "skins/skin_scanner.h"

namespace mania {

namespace {

using nlohmann::json;

constexpr const char* kProfileFileName = "skin.styles.json";

std::mutex gProfileMutex;

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

bool readDocument(const std::filesystem::path& path, json& document,
                  std::string& error) {
  if (!std::filesystem::exists(path)) {
    document = {{"version", 1}, {"skins", json::object()}};
    return true;
  }
  auto text = readFileText(path);
  try {
    document = json::parse(text);
  } catch (...) {
    error = "样式配置文件损坏，无法解析 " + std::string(kProfileFileName);
    return false;
  }
  if (!document.is_object()) {
    error = "样式配置文件格式错误";
    return false;
  }
  if (!document.contains("skins") || !document["skins"].is_object()) {
    document["skins"] = json::object();
  }
  return true;
}

bool writeDocument(const std::filesystem::path& path, const json& document,
                   std::string& error) {
  if (!writeFileText(path, document.dump(2))) {
    error = "写入样式配置文件失败";
    return false;
  }
  return true;
}

bool isValidStyleName(const std::string& name) {
  if (name.empty() || name.size() > 60) {
    return false;
  }
  for (unsigned char c : name) {
    if (c < 0x20) {
      return false;
    }
  }
  return true;
}

std::string skinKey(const std::filesystem::path& skinDir) {
  return pathToUtf8(skinDir.filename());
}

}  // namespace

std::filesystem::path StyleProfile::profilePath(
    const std::filesystem::path& skinDir) {
  return skinDir.parent_path() / kProfileFileName;
}

json StyleProfile::load(const std::filesystem::path& skinDir) {
  std::lock_guard lock(gProfileMutex);
  json document;
  std::string error;
  if (!readDocument(profilePath(skinDir), document, error)) {
    return json::object();
  }
  auto name = skinKey(skinDir);
  if (document["skins"].contains(name) &&
      document["skins"][name].is_object()) {
    return document["skins"][name];
  }
  return json::object();
}

json StyleProfile::summary(const std::filesystem::path& skinDir) {
  json styles = load(skinDir);
  json out = json::object();
  for (auto it = styles.begin(); it != styles.end(); ++it) {
    if (!it.value().is_array()) {
      continue;
    }
    json names = json::array();
    for (const auto& style : it.value()) {
      if (style.is_object() && style.contains("name") &&
          style["name"].is_string()) {
        names.push_back(style["name"].get<std::string>());
      }
    }
    out[it.key()] = std::move(names);
  }
  return out;
}

bool StyleProfile::saveStyle(const std::filesystem::path& skinDir, int keys,
                             const std::string& name,
                             const nlohmann::json& values,
                             std::string& error) {
  if (!isValidKeysValue(keys)) {
    error = "keys 无效";
    return false;
  }
  if (!isValidStyleName(name)) {
    error = "样式名称无效";
    return false;
  }
  if (!values.is_object()) {
    error = "values 必须是对象";
    return false;
  }
  std::lock_guard lock(gProfileMutex);
  auto path = profilePath(skinDir);
  json document;
  if (!readDocument(path, document, error)) {
    return false;
  }
  auto nameKey = skinKey(skinDir);
  auto& skins = document["skins"];
  if (!skins.contains(nameKey) || !skins[nameKey].is_object()) {
    skins[nameKey] = json::object();
  }
  auto key = std::to_string(keys);
  auto& styles = skins[nameKey];
  if (!styles.contains(key) || !styles[key].is_array()) {
    styles[key] = json::array();
  }
  for (auto& style : styles[key]) {
    if (style.is_object() && style.value("name", "") == name) {
      style["values"] = values;
      return writeDocument(path, document, error);
    }
  }
  styles[key].push_back({{"name", name}, {"values", values}});
  return writeDocument(path, document, error);
}

bool StyleProfile::deleteStyle(const std::filesystem::path& skinDir,
                               int keys, const std::string& name,
                               std::string& error) {
  if (!isValidKeysValue(keys)) {
    error = "keys 无效";
    return false;
  }
  std::lock_guard lock(gProfileMutex);
  auto path = profilePath(skinDir);
  json document;
  if (!readDocument(path, document, error)) {
    return false;
  }
  auto nameKey = skinKey(skinDir);
  auto& skins = document["skins"];
  if (!skins.contains(nameKey) || !skins[nameKey].is_object()) {
    error = "样式不存在";
    return false;
  }
  auto key = std::to_string(keys);
  auto& styles = skins[nameKey];
  if (!styles.contains(key) || !styles[key].is_array()) {
    error = "样式不存在";
    return false;
  }
  auto& list = styles[key];
  auto it = std::remove_if(
      list.begin(), list.end(), [&](const json& style) {
        return style.is_object() && style.value("name", "") == name;
      });
  if (it == list.end()) {
    error = "样式不存在";
    return false;
  }
  list.erase(it, list.end());
  return writeDocument(path, document, error);
}

bool StyleProfile::renameStyle(const std::filesystem::path& skinDir,
                               int keys, const std::string& oldName,
                               const std::string& newName,
                               std::string& error) {
  if (!isValidKeysValue(keys)) {
    error = "keys 无效";
    return false;
  }
  if (!isValidStyleName(newName)) {
    error = "新样式名称无效";
    return false;
  }
  std::lock_guard lock(gProfileMutex);
  auto path = profilePath(skinDir);
  json document;
  if (!readDocument(path, document, error)) {
    return false;
  }
  auto nameKey = skinKey(skinDir);
  auto& skins = document["skins"];
  if (!skins.contains(nameKey) || !skins[nameKey].is_object()) {
    error = "样式不存在";
    return false;
  }
  auto key = std::to_string(keys);
  auto& styles = skins[nameKey];
  if (!styles.contains(key) || !styles[key].is_array()) {
    error = "样式不存在";
    return false;
  }
  bool found = false;
  for (auto& style : styles[key]) {
    if (style.is_object() && style.value("name", "") == oldName) {
      style["name"] = newName;
      found = true;
      break;
    }
  }
  if (!found) {
    error = "样式不存在";
    return false;
  }
  return writeDocument(path, document, error);
}

bool StyleProfile::copySkinStyles(const std::filesystem::path& parent,
                                  const std::string& fromName,
                                  const std::string& toName,
                                  std::string& error) {
  std::lock_guard lock(gProfileMutex);
  auto path = parent / kProfileFileName;
  if (!std::filesystem::exists(path)) {
    return true;
  }
  json document;
  if (!readDocument(path, document, error)) {
    return false;
  }
  auto& skins = document["skins"];
  if (skins.contains(fromName) && skins[fromName].is_object()) {
    skins[toName] = skins[fromName];
  }
  return writeDocument(path, document, error);
}

bool StyleProfile::renameSkinStyles(const std::filesystem::path& parent,
                                    const std::string& oldName,
                                    const std::string& newName,
                                    std::string& error) {
  std::lock_guard lock(gProfileMutex);
  auto path = parent / kProfileFileName;
  if (!std::filesystem::exists(path)) {
    return true;
  }
  json document;
  if (!readDocument(path, document, error)) {
    return false;
  }
  auto& skins = document["skins"];
  if (skins.contains(oldName)) {
    skins[newName] = skins[oldName];
    skins.erase(oldName);
  }
  return writeDocument(path, document, error);
}

json StyleProfile::takeSkinStyles(const std::filesystem::path& parent,
                                  const std::string& name) {
  std::lock_guard lock(gProfileMutex);
  auto path = parent / kProfileFileName;
  if (!std::filesystem::exists(path)) {
    return json::object();
  }
  json document;
  std::string error;
  if (!readDocument(path, document, error)) {
    return json::object();
  }
  auto& skins = document["skins"];
  json removed;
  if (skins.contains(name)) {
    removed = skins[name];
    skins.erase(name);
  }
  if (!writeDocument(path, document, error)) {
    return json::object();
  }
  return removed;
}

bool StyleProfile::restoreSkinStyles(const std::filesystem::path& parent,
                                     const std::string& name,
                                     const nlohmann::json& styles,
                                     std::string& error) {
  std::lock_guard lock(gProfileMutex);
  auto path = parent / kProfileFileName;
  json document;
  if (!readDocument(path, document, error)) {
    return false;
  }
  auto& skins = document["skins"];
  if (styles.is_object()) {
    skins[name] = styles;
  } else {
    skins.erase(name);
  }
  return writeDocument(path, document, error);
}

}  // namespace mania
