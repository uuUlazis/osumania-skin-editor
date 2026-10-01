#include "http/api_server.h"

#include <windows.h>

#include <atomic>
#include <algorithm>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <optional>
#include <sstream>
#include <string_view>
#include <unordered_set>

#include <json.hpp>

#include "app/history_store.h"
#include "app/launcher.h"
#include "embedded_files.h"
#include "image/png_tool.h"
#include "image/work_session.h"
#include "ini/ini_document.h"
#include "ini/mania_schema.h"
#include "skins/skin_scanner.h"
#include "skins/style_profile.h"

namespace mania {

namespace {

using nlohmann::json;

std::string readFileBinary(const std::filesystem::path& path) {
  std::ifstream stream(path, std::ios::binary);
  if (!stream) {
    return {};
  }
  std::ostringstream buffer;
  buffer << stream.rdbuf();
  return buffer.str();
}

bool writeFileBinary(const std::filesystem::path& path,
                     const std::string& text) {
  std::ofstream stream(path, std::ios::binary | std::ios::trunc);
  if (!stream) {
    return false;
  }
  stream.write(text.data(), static_cast<std::streamsize>(text.size()));
  stream.flush();
  stream.close();
  return static_cast<bool>(stream);
}

void respondJson(httplib::Response& res, const json& body, int status = 200) {
  res.status = status;
  res.set_content(body.dump(), "application/json; charset=utf-8");
}

void respondError(httplib::Response& res, int status,
                  const std::string& message) {
  respondJson(res, {{"error", message}}, status);
}

bool isDirectory(const std::filesystem::path& path) {
  std::error_code ec;
  return std::filesystem::is_directory(path, ec) && !ec;
}

bool isRegularFile(const std::filesystem::path& path) {
  std::error_code ec;
  return std::filesystem::is_regular_file(path, ec) && !ec;
}

std::string lowerExtension(std::string_view name) {
  auto pos = name.rfind('.');
  if (pos == std::string_view::npos) {
    return {};
  }
  return toLowerAscii(name.substr(pos));
}

std::string mimeForExtension(std::string_view name) {
  const std::string ext = lowerExtension(name);
  if (ext == ".html" || ext == ".htm") return "text/html; charset=utf-8";
  if (ext == ".js" || ext == ".mjs") return "text/javascript; charset=utf-8";
  if (ext == ".css") return "text/css; charset=utf-8";
  if (ext == ".svg") return "image/svg+xml";
  if (ext == ".png") return "image/png";
  if (ext == ".jpg" || ext == ".jpeg") return "image/jpeg";
  if (ext == ".webp") return "image/webp";
  if (ext == ".gif") return "image/gif";
  if (ext == ".bmp") return "image/bmp";
  if (ext == ".ico") return "image/x-icon";
  if (ext == ".woff2") return "font/woff2";
  if (ext == ".woff") return "font/woff";
  if (ext == ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

bool isVersionAtLeast25(std::string_view version) {
  std::string lower = toLowerAscii(version);
  if (lower == "latest" || lower == "user") {
    return true;
  }
  int major = 0;
  double minor = 0;
  if (std::sscanf(lower.c_str(), "%d.%lf", &major, &minor) != 2) {
    return false;
  }
  return major > 2 || (major == 2 && minor >= 0.5);
}

json blockToJson(const IniDocument& document,
                 const ManiaBlockView& block) {
  json valueMap = json::object();
  for (size_t idx : block.entryIndices) {
    const IniLine& line = document.lines()[idx];
    valueMap[line.key] = line.value;
  }
  json out = json::object();
  out["keys"] = block.keys ? json(*block.keys) : json(nullptr);
  out["values"] = std::move(valueMap);
  return out;
}

json pngMetricsToJson(const PngMetrics& metrics) {
  return {{"valid", metrics.valid},
          {"width", metrics.width},
          {"height", metrics.height},
          {"topSpacing", metrics.topSpacing},
          {"leftSpacing", metrics.leftSpacing},
          {"rightSpacing", metrics.rightSpacing},
          {"bottomSpacing", metrics.bottomSpacing},
          {"minAlpha", metrics.minAlpha},
          {"maxAlpha", metrics.maxAlpha},
          {"fullyTransparentCount", metrics.fullyTransparentCount},
          {"fullyOpaqueCount", metrics.fullyOpaqueCount},
          {"totalPixels", metrics.totalPixels}};
}

std::vector<std::string> collectWarnings(const IniDocument& document) {
  std::vector<std::string> warnings;
  auto blocks = document.maniaBlocks();
  std::unordered_set<int> seen;
  for (const auto& block : blocks) {
    if (!block.keys) {
      continue;
    }
    if (!seen.insert(*block.keys).second) {
      warnings.push_back("存在多个 Keys=" + std::to_string(*block.keys) +
                         " 的 [Mania] 小节，游戏只会使用其中一个");
    }
  }
  return warnings;
}

bool loadSkinIni(const std::filesystem::path& skinDir,
                 IniDocument& document, std::string& raw,
                 std::string& error) {
  auto iniPath = skinDir / "skin.ini";
  if (!isRegularFile(iniPath)) {
    error = "该皮肤没有 skin.ini";
    return false;
  }
  raw = readFileBinary(iniPath);
  auto parsed = IniDocument::parse(raw);
  if (!parsed) {
    error = "skin.ini 解析失败";
    return false;
  }
  document = std::move(*parsed);
  return true;
}

std::filesystem::path tempPreviewPath() {
  static std::atomic<unsigned> counter{0};
  return std::filesystem::temp_directory_path() /
         ("mania_preview_" + std::to_string(GetTickCount64()) + "_" +
          std::to_string(counter.fetch_add(1)) + ".png");
}

void collectImages(const std::filesystem::path& root,
                   const std::filesystem::path& current, int depth,
                   std::vector<std::string>& out) {
  if (depth > 3 || out.size() >= 800) {
    return;
  }
  std::error_code ec;
  for (auto it = std::filesystem::directory_iterator(current, ec);
       !ec && it != std::filesystem::directory_iterator(); it.increment(ec)) {
    if (ec) {
      break;
    }
    const auto& entry = *it;
    std::error_code itemEc;
    if (entry.is_directory(itemEc) && !itemEc) {
      collectImages(root, entry.path(), depth + 1, out);
      continue;
    }
    if (!entry.is_regular_file(itemEc) || itemEc) {
      continue;
    }
    const std::string ext =
        lowerExtension(pathToUtf8(entry.path().filename()));
    if (ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".webp" ||
        ext == ".gif" || ext == ".bmp") {
      auto relative = entry.path().lexically_relative(root);
      std::string name = pathToUtf8(relative);
      std::replace(name.begin(), name.end(), '\\', '/');
      out.push_back(std::move(name));
    }
  }
}

bool loadEmbeddedFile(std::string_view urlPath, std::string& out) {
#if MANIA_HAS_EMBEDDED
  const EmbeddedFile* file = maniaEmbeddedFile(urlPath);
  if (!file) {
    return false;
  }
  HRSRC resource = FindResourceW(nullptr, MAKEINTRESOURCEW(file->id), RT_RCDATA);
  if (!resource) {
    return false;
  }
  HGLOBAL handle = LoadResource(nullptr, resource);
  if (!handle) {
    return false;
  }
  DWORD size = SizeofResource(nullptr, resource);
  const char* data = static_cast<const char*>(LockResource(handle));
  if (!data || size == 0) {
    return false;
  }
  out.assign(data, size);
  return true;
#else
  (void)urlPath;
  (void)out;
  return false;
#endif
}

std::optional<std::filesystem::path> skinDirFromParam(
    const httplib::Request& req, httplib::Response& res) {
  auto value = req.get_param_value("path");
  if (value.empty()) {
    respondError(res, 400, "缺少 path 参数");
    return std::nullopt;
  }
  auto path = pathFromUtf8(value);
  if (!isDirectory(path)) {
    respondError(res, 400, "path 不是有效目录");
    return std::nullopt;
  }
  return path;
}

}  // namespace

ApiServer::ApiServer(int port) : port_(port) {}

ApiServer::~ApiServer() {
  stop();
}

bool ApiServer::start() {
  registerRoutes();
  int boundPort = server_.bind_to_any_port("127.0.0.1");
  if (boundPort < 0) {
    return false;
  }
  port_ = boundPort;
  listener_ = std::thread([this] { server_.listen_after_bind(); });
  return true;
}

void ApiServer::stop() {
  server_.stop();
  if (listener_.joinable()) {
    listener_.join();
  }
}

void ApiServer::registerRoutes() {
  server_.Get("/api/health", [](const httplib::Request&, httplib::Response& res) {
    respondJson(res, {{"ok", true}, {"name", "ManiaSkinEditor"}});
  });

  server_.Get("/api/history",
              [](const httplib::Request&, httplib::Response& res) {
                respondJson(res, {{"entries", HistoryStore::load()}});
              });

  server_.Post("/api/history/remove",
               [](const httplib::Request& req, httplib::Response& res) {
                 json body;
                 try {
                   body = json::parse(req.body);
                 } catch (...) {
                   respondError(res, 400, "请求体不是有效 JSON");
                   return;
                 }
                 auto path = body.value("path", "");
                 if (path.empty()) {
                   respondError(res, 400, "缺少 path");
                   return;
                 }
                 HistoryStore::remove(path);
                 respondJson(res,
                             {{"ok", true}, {"entries", HistoryStore::load()}});
               });

  server_.Get("/api/schema", [](const httplib::Request&, httplib::Response& res) {
    json fields = json::array();
    for (const auto& field : maniaFields()) {
      json item = json::object();
      item["name"] = field.name;
      item["label"] = field.label;
      item["group"] = field.group;
      item["type"] = fieldTypeName(field.type);
      item["defaultValue"] = field.defaultValue;
      item["perColumn"] = field.perColumn;
      item["indexStart"] = field.indexStart;
      item["indexSuffix"] = field.indexSuffix;
      item["enumValues"] = field.enumValues;
      item["help"] = field.help;
      item["requiresVersion25"] = field.requiresVersion25;
      fields.push_back(std::move(item));
    }
    respondJson(res, {{"fields", std::move(fields)}});
  });

  server_.Post("/api/skin-dir/pick", [](const httplib::Request&,
                                        httplib::Response& res) {
    auto picked = pickFolder();
    if (!picked) {
      respondJson(res, {{"cancelled", true}});
      return;
    }
    respondJson(res, {{"cancelled", false}, {"path", pathToUtf8(*picked)}});
  });

  server_.Post("/api/skin-dir/open",
               [](const httplib::Request& req, httplib::Response& res) {
                 json body;
                 try {
                   body = json::parse(req.body);
                 } catch (...) {
                   respondError(res, 400, "请求体不是有效 JSON");
                   return;
                 }
                 auto pathText = body.value("path", "");
                 if (pathText.empty()) {
                   respondError(res, 400, "缺少 path");
                   return;
                 }
                 auto root = pathFromUtf8(pathText);
                 if (!isDirectory(root)) {
                   respondError(res, 400, "绑定目录不存在或不是目录");
                   return;
                 }
                 json skins = json::array();
                 for (const auto& skin : scanSkins(root)) {
                   json item;
                   item["name"] = skin.name;
                   item["path"] = skin.path;
                   item["hasIni"] = skin.hasIni;
                   item["keys"] = skin.keys;
                   auto styleSummary =
                       StyleProfile::summary(pathFromUtf8(skin.path));
                   int styleCount = 0;
                   for (const auto& names : styleSummary) {
                     styleCount += names.is_array()
                                       ? static_cast<int>(names.size())
                                       : 0;
                   }
                   item["styleSummary"] = std::move(styleSummary);
                   item["styleCount"] = styleCount;
                   if (!skin.error.empty()) {
                     item["error"] = skin.error;
                   }
                   skins.push_back(std::move(item));
                 }
                 HistoryStore::record(root);
                 respondJson(res,
                             {{"path", pathText}, {"skins", std::move(skins)}});
               });

  server_.Get("/api/skin",
              [](const httplib::Request& req, httplib::Response& res) {
                auto skinDir = skinDirFromParam(req, res);
                if (!skinDir) {
                  return;
                }
                auto iniPath = *skinDir / "skin.ini";
                if (!isRegularFile(iniPath)) {
                  respondJson(res, {{"path", pathToUtf8(*skinDir)},
                                    {"hasIni", false}});
                  return;
                }
                IniDocument document;
                std::string raw;
                std::string error;
                if (!loadSkinIni(*skinDir, document, raw, error)) {
                  respondError(res, 500, error);
                  return;
                }
                json blocks = json::array();
                for (const auto& block : document.maniaBlocks()) {
                  if (block.keys) {
                    blocks.push_back(blockToJson(document, block));
                  }
                }
                json version = nullptr;
                if (auto v = document.generalVersion()) {
                  version = *v;
                }
                respondJson(res,
                            {{"path", pathToUtf8(*skinDir)},
                             {"hasIni", true},
                             {"version", version},
                             {"blocks", std::move(blocks)},
                             {"warnings", collectWarnings(document)},
                             {"raw", raw}});
              });

  server_.Get("/api/skin/ini",
              [](const httplib::Request& req, httplib::Response& res) {
                auto skinDir = skinDirFromParam(req, res);
                if (!skinDir) {
                  return;
                }
                auto iniPath = *skinDir / "skin.ini";
                if (!isRegularFile(iniPath)) {
                  respondError(res, 404, "skin.ini 不存在");
                  return;
                }
                res.set_content(readFileBinary(iniPath),
                                "text/plain; charset=utf-8");
              });

  server_.Get("/api/skin/images",
              [](const httplib::Request& req, httplib::Response& res) {
                auto skinDir = skinDirFromParam(req, res);
                if (!skinDir) {
                  return;
                }
                std::vector<std::string> images;
                collectImages(*skinDir, *skinDir, 0, images);
                std::sort(images.begin(), images.end());
                respondJson(res, {{"images", images}});
              });

  server_.Get("/api/skin/image",
              [](const httplib::Request& req, httplib::Response& res) {
                auto skinDir = skinDirFromParam(req, res);
                if (!skinDir) {
                  return;
                }
                auto name = req.get_param_value("name");
                if (name.empty()) {
                  respondError(res, 400, "缺少 name 参数");
                  return;
                }
                auto resolved = resolveWithinRoot(*skinDir, name);
                if (!resolved || !isRegularFile(*resolved)) {
                  respondError(res, 404, "图片不存在");
                  return;
                }
                res.set_content(readFileBinary(*resolved),
                                mimeForExtension(pathToUtf8(resolved->filename())));
              });

  server_.Get("/api/skin/image/info",
              [](const httplib::Request& req, httplib::Response& res) {
                auto skinDir = skinDirFromParam(req, res);
                if (!skinDir) {
                  return;
                }
                auto name = req.get_param_value("name");
                if (name.empty()) {
                  respondError(res, 400, "缺少 name 参数");
                  return;
                }
                auto resolved = resolveWithinRoot(*skinDir, name);
                if (!resolved || !isRegularFile(*resolved) ||
                    !PngTool::isPngName(*resolved)) {
                  respondError(res, 404, "PNG 图片不存在");
                  return;
                }
                PngMetrics metrics;
                std::string error;
                if (!PngTool::analyze(*resolved, metrics, error)) {
                  respondError(res, 400, error);
                  return;
                }
                respondJson(res,
                            {{"ok", true},
                             {"name", name},
                                 {"metrics", pngMetricsToJson(metrics)}});
              });

  server_.Post("/api/skin/image/pick",
               [](const httplib::Request& req, httplib::Response& res) {
                 json body;
                 try {
                   body = json::parse(req.body);
                 } catch (...) {
                   respondError(res, 400, "请求体不是有效 JSON");
                   return;
                 }
                 auto pathText = body.value("path", "");
                 if (pathText.empty()) {
                   respondError(res, 400, "缺少 path");
                   return;
                 }
                 auto skinDir = pathFromUtf8(pathText);
                 if (!isDirectory(skinDir)) {
                   respondError(res, 400, "path 不是有效目录");
                   return;
                 }
                 auto picked = pickPngFile(skinDir);
                 if (!picked) {
                   respondJson(res, {{"cancelled", true}});
                   return;
                 }
                 auto relative = picked->lexically_relative(skinDir);
                 if (relative.empty() || *relative.begin() == ".." ||
                     !PngTool::isPngName(*picked)) {
                   respondError(
                       res, 400,
                       "请选择该皮肤目录或其子目录内的 PNG 图片");
                   return;
                 }
                 std::string name = pathToUtf8(relative);
                 std::replace(name.begin(), name.end(), '\\', '/');
                  respondJson(res,
                              {{"cancelled", false},
                               {"name", name},
                               {"path", pathToUtf8(*picked)}});
               });

  server_.Post("/api/skin/image/save-as",
               [](const httplib::Request& req, httplib::Response& res) {
                 json body;
                 try {
                   body = json::parse(req.body);
                 } catch (...) {
                   respondError(res, 400, "请求体不是有效 JSON");
                   return;
                 }
                 auto pathText = body.value("path", "");
                 auto name = body.value("name", "");
                 auto workId = body.value("workId", "");
                 if (pathText.empty() || name.empty()) {
                   respondError(res, 400, "缺少 path 或 name");
                   return;
                 }
                 auto skinDir = pathFromUtf8(pathText);
                 auto sourceOnDisk = resolveWithinRoot(skinDir, name);
                 if (!isDirectory(skinDir) || !sourceOnDisk ||
                     !isRegularFile(*sourceOnDisk) ||
                     !PngTool::isPngName(*sourceOnDisk)) {
                   respondError(res, 400, "图片路径无效或不是 PNG");
                   return;
                 }

                 std::filesystem::path sourceForEdit = *sourceOnDisk;
                 if (!workId.empty() &&
                     !WorkSession::workingPath(workId, sourceForEdit)) {
                   respondError(res, 404, "工作会话不存在");
                   return;
                 }

                 auto initialDir = sourceOnDisk->parent_path();
                 auto picked =
                     pickPngSavePath(initialDir,
                                     sourceOnDisk->filename().wstring());
                 if (!picked) {
                   respondJson(res, {{"cancelled", true}});
                   return;
                 }
                 if (!PngTool::isPngName(*picked)) {
                   respondError(res, 400, "另存为仅支持 PNG 文件");
                   return;
                 }

                 PngEditOptions options;
                 options.topMargin = body.value("top", -1);
                 options.leftMargin = body.value("left", -1);
                 options.rightMargin = body.value("right", -1);
                 options.alphaScalePercent =
                     body.value("alphaScalePercent", 100);
                 options.alphaValue = body.value("alphaValue", -1);

                 std::optional<std::filesystem::path> backup;
                 if (picked->lexically_normal() ==
                     sourceOnDisk->lexically_normal()) {
                   auto backupPath = *sourceOnDisk;
                   backupPath += L".bak";
                   if (!CopyFileW(sourceOnDisk->c_str(),
                                  backupPath.c_str(), FALSE)) {
                     respondError(res, 500, "创建图片备份失败");
                     return;
                   }
                   backup = backupPath;
                 }

                 PngMetrics metrics;
                 std::string error;
                 if (!PngTool::edit(sourceForEdit, *picked, options, metrics,
                                    error)) {
                   respondError(res, 400, error);
                   return;
                 }
                 json response = {
                     {"ok", true},
                     {"cancelled", false},
                     {"name", pathToUtf8(picked->filename())},
                     {"path", pathToUtf8(*picked)},
                     {"metrics", pngMetricsToJson(metrics)},
                 };
                 if (backup) {
                   response["backup"] = pathToUtf8(*backup);
                 }
                 respondJson(res, std::move(response));
               });

  server_.Post("/api/skin/image/edit",
               [](const httplib::Request& req, httplib::Response& res) {
                 json body;
                 try {
                   body = json::parse(req.body);
                 } catch (...) {
                   respondError(res, 400, "请求体不是有效 JSON");
                   return;
                 }
                 auto pathText = body.value("path", "");
                 auto name = body.value("name", "");
                 auto targetName = body.value("targetName", name);
                 if (pathText.empty() || name.empty() || targetName.empty()) {
                   respondError(res, 400, "缺少 path 或 name");
                   return;
                 }
                 auto skinDir = pathFromUtf8(pathText);
                 if (!isDirectory(skinDir)) {
                   respondError(res, 400, "path 不是有效目录");
                   return;
                 }
                 auto source = resolveWithinRoot(skinDir, name);
                 auto target = resolveWithinRoot(skinDir, targetName);
                 if (!source || !target || !isRegularFile(*source) ||
                     !PngTool::isPngName(*source) ||
                     !PngTool::isPngName(*target)) {
                   respondError(res, 400, "图片路径无效或不是 PNG");
                   return;
                 }

                 PngEditOptions options;
                 options.topMargin = body.value("top", -1);
                 options.leftMargin = body.value("left", -1);
                 options.rightMargin = body.value("right", -1);
                 options.alphaScalePercent = body.value("alphaScalePercent", 100);
                 options.alphaValue = body.value("alphaValue", -1);

                 std::optional<std::filesystem::path> backup;
                 if (source->lexically_normal() == target->lexically_normal()) {
                   auto backupPath =
                       *source;
                   backupPath += L".bak";
                   if (!CopyFileW(source->c_str(), backupPath.c_str(), FALSE)) {
                     respondError(res, 500, "创建图片备份失败");
                     return;
                   }
                   backup = backupPath;
                 }

                 PngMetrics metrics;
                 std::string error;
                 if (!PngTool::edit(*source, *target, options, metrics,
                                    error)) {
                   respondError(res, 400, error);
                   return;
                 }
                 json response = {{"ok", true},
                                  {"name", targetName},
                                  {"metrics", pngMetricsToJson(metrics)}};
                 if (backup) {
                   response["backup"] = pathToUtf8(*backup);
                 }
                  respondJson(res, std::move(response));
                });

  server_.Post("/api/skin/image/preview",
               [](const httplib::Request& req, httplib::Response& res) {
                 json body;
                 try {
                   body = json::parse(req.body);
                 } catch (...) {
                   respondError(res, 400, "请求体不是有效 JSON");
                   return;
                 }
                 auto pathText = body.value("path", "");
                 auto name = body.value("name", "");
                 if (pathText.empty() || name.empty()) {
                   respondError(res, 400, "缺少 path 或 name");
                   return;
                 }
                 auto skinDir = pathFromUtf8(pathText);
                 if (!isDirectory(skinDir)) {
                   respondError(res, 400, "path 不是有效目录");
                   return;
                 }
                 auto source = resolveWithinRoot(skinDir, name);
                 if (!source || !isRegularFile(*source) ||
                     !PngTool::isPngName(*source)) {
                   respondError(res, 400, "图片路径无效或不是 PNG");
                   return;
                 }
                 PngEditOptions options;
                 options.topMargin = body.value("top", -1);
                 options.leftMargin = body.value("left", -1);
                 options.rightMargin = body.value("right", -1);
                 options.alphaScalePercent =
                     body.value("alphaScalePercent", 100);
                 options.alphaValue = body.value("alphaValue", -1);

                 auto previewPath = tempPreviewPath();
                 PngMetrics metrics;
                 std::string error;
                 bool ok = PngTool::edit(*source, previewPath, options,
                                         metrics, error);
                 std::string bytes;
                 if (ok) {
                   bytes = readFileBinary(previewPath);
                   std::error_code removeEc;
                   std::filesystem::remove(previewPath, removeEc);
                 }
                 if (!ok || bytes.empty()) {
                   std::error_code removeEc;
                   std::filesystem::remove(previewPath, removeEc);
                   respondError(res, 400, ok ? "生成预览失败" : error);
                   return;
                 }
                 res.set_header("X-Preview-Width",
                                std::to_string(metrics.width));
                 res.set_header("X-Preview-Height",
                                std::to_string(metrics.height));
                 res.set_content(bytes, "image/png");
               });

  server_.Get("/api/skin/image/working",
              [](const httplib::Request& req, httplib::Response& res) {
                auto workId = req.get_param_value("workId");
                if (workId.empty()) {
                  respondError(res, 400, "缺少 workId");
                  return;
                }
                std::filesystem::path workPath;
                if (!WorkSession::workingPath(workId, workPath)) {
                  respondError(res, 404, "工作会话不存在");
                  return;
                }
                res.set_content(readFileBinary(workPath), "image/png");
              });

  server_.Post("/api/skin/image/preview-working",
               [](const httplib::Request& req, httplib::Response& res) {
                 json body;
                 try {
                   body = json::parse(req.body);
                 } catch (...) {
                   respondError(res, 400, "请求体不是有效 JSON");
                   return;
                 }
                 auto workId = body.value("workId", "");
                 if (workId.empty()) {
                   respondError(res, 400, "缺少 workId");
                   return;
                 }
                 std::filesystem::path workPath;
                 if (!WorkSession::workingPath(workId, workPath)) {
                   respondError(res, 404, "工作会话不存在");
                   return;
                 }
                 PngEditOptions options;
                 options.topMargin = body.value("top", -1);
                 options.leftMargin = body.value("left", -1);
                 options.rightMargin = body.value("right", -1);
                 options.alphaScalePercent =
                     body.value("alphaScalePercent", 100);
                 options.alphaValue = body.value("alphaValue", -1);
                 auto previewPath = tempPreviewPath();
                 PngMetrics metrics;
                 std::string error;
                 bool ok = PngTool::edit(workPath, previewPath, options,
                                         metrics, error);
                 std::string bytes;
                 if (ok) {
                   bytes = readFileBinary(previewPath);
                   std::error_code removeEc;
                   std::filesystem::remove(previewPath, removeEc);
                 }
                 if (!ok || bytes.empty()) {
                   std::error_code removeEc;
                   std::filesystem::remove(previewPath, removeEc);
                   respondError(res, 400, ok ? "生成预览失败" : error);
                   return;
                 }
                 res.set_header("X-Preview-Width",
                                std::to_string(metrics.width));
                 res.set_header("X-Preview-Height",
                                std::to_string(metrics.height));
                 res.set_content(bytes, "image/png");
               });

  server_.Post("/api/skin/image/local/start",
               [](const httplib::Request& req, httplib::Response& res) {
                 json body;
                 try {
                   body = json::parse(req.body);
                 } catch (...) {
                   respondError(res, 400, "请求体不是有效 JSON");
                   return;
                 }
                 auto pathText = body.value("path", "");
                 auto name = body.value("name", "");
                 if (pathText.empty() || name.empty()) {
                   respondError(res, 400, "缺少 path 或 name");
                   return;
                 }
                 std::string workId;
                 PngMetrics metrics;
                 std::string error;
                 if (!WorkSession::start(pathFromUtf8(pathText), name, workId,
                                         metrics, error)) {
                   respondError(res, 400, error);
                   return;
                 }
                 json response = {
                     {"ok", true},
                     {"workId", workId},
                     {"metrics", pngMetricsToJson(metrics)},
                     {"canUndo", false},
                     {"canRedo", false},
                 };
                 respondJson(res, std::move(response));
               });

  auto parseRect = [](const json& body, const char* prefix, ImageRect& rect,
                      bool& ok) {
    ok = body.contains(std::string(prefix) + "X0") &&
         body.contains(std::string(prefix) + "Y0") &&
         body.contains(std::string(prefix) + "X1") &&
         body.contains(std::string(prefix) + "Y1");
    if (!ok) {
      return;
    }
    rect.x0 = body.value(std::string(prefix) + "X0", 0);
    rect.y0 = body.value(std::string(prefix) + "Y0", 0);
    rect.x1 = body.value(std::string(prefix) + "X1", 0);
    rect.y1 = body.value(std::string(prefix) + "Y1", 0);
  };

  server_.Post("/api/skin/image/local/transform",
               [parseRect](const httplib::Request& req,
                           httplib::Response& res) {
                 json body;
                 try {
                   body = json::parse(req.body);
                 } catch (...) {
                   respondError(res, 400, "请求体不是有效 JSON");
                   return;
                 }
                 auto workId = body.value("workId", "");
                 if (workId.empty()) {
                   respondError(res, 400, "缺少 workId");
                   return;
                 }
                 ImageRect source;
                 ImageRect target;
                 bool sourceOk = false;
                 bool targetOk = false;
                 parseRect(body, "source", source, sourceOk);
                 parseRect(body, "target", target, targetOk);
                 if (!sourceOk || !targetOk) {
                   respondError(res, 400, "缺少选区坐标");
                   return;
                 }
                 PngMetrics metrics;
                 std::string error;
                 if (!WorkSession::transform(workId, source, target, metrics,
                                             error)) {
                   respondError(res, 400, error);
                   return;
                 }
                 json response = {
                     {"ok", true},
                     {"metrics", pngMetricsToJson(metrics)},
                     {"canUndo", true},
                     {"canRedo", false},
                 };
                 respondJson(res, std::move(response));
               });

  server_.Post("/api/skin/image/local/border-line",
               [](const httplib::Request& req, httplib::Response& res) {
                 json body;
                 try {
                   body = json::parse(req.body);
                 } catch (...) {
                   respondError(res, 400, "请求体不是有效 JSON");
                   return;
                 }
                 auto workId = body.value("workId", "");
                 if (workId.empty()) {
                   respondError(res, 400, "缺少 workId");
                   return;
                 }
                 auto sideName = body.value("side", "");
                 int side = -1;
                 if (sideName == "top") {
                   side = 0;
                 } else if (sideName == "bottom") {
                   side = 1;
                 } else if (sideName == "left") {
                   side = 2;
                 } else if (sideName == "right") {
                   side = 3;
                 }
                 if (side < 0) {
                   respondError(res, 400, "边线方向无效");
                   return;
                 }
                 auto numberOr = [&body](const char* key, int fallback) {
                   return body.contains(key) && body[key].is_number()
                              ? body[key].get<int>()
                              : fallback;
                 };
                 PngLineOptions options;
                 options.side = side;
                 options.position = numberOr("position", -1);
                 options.width = numberOr("width", 1);
                 options.r = numberOr("r", 255);
                 options.g = numberOr("g", 255);
                 options.b = numberOr("b", 255);
                 options.a = numberOr("a", 255);
                 PngMetrics metrics;
                 std::string error;
                 if (!WorkSession::drawLine(workId, options, metrics, error)) {
                   respondError(res, 400, error);
                   return;
                 }
                 json response = {
                     {"ok", true},
                     {"metrics", pngMetricsToJson(metrics)},
                     {"canUndo", true},
                     {"canRedo", false},
                 };
                 respondJson(res, std::move(response));
               });

  server_.Post("/api/skin/image/local/profile",
               [](const httplib::Request& req, httplib::Response& res) {
                 json body;
                 try {
                   body = json::parse(req.body);
                 } catch (...) {
                   respondError(res, 400, "请求体不是有效 JSON");
                   return;
                 }
                 auto workId = body.value("workId", "");
                 if (workId.empty()) {
                   respondError(res, 400, "缺少 workId");
                   return;
                 }
                 PngContentProfile profile;
                 std::string error;
                 if (!WorkSession::contentProfile(workId, profile, error)) {
                   respondError(res, 400, error);
                   return;
                 }
                 json response = {
                     {"ok", true},
                     {"width", profile.width},
                     {"height", profile.height},
                     {"hasContent", profile.hasContent},
                     {"content",
                      {{"minX", profile.minX},
                       {"maxX", profile.maxX},
                       {"minY", profile.minY},
                       {"maxY", profile.maxY}}},
                     {"edges",
                      {{"left", profile.leftEdges},
                       {"right", profile.rightEdges},
                       {"top", profile.topEdges},
                       {"bottom", profile.bottomEdges}}},
                 };
                 respondJson(res, std::move(response));
               });

  auto localHistoryEndpoint =
      [](httplib::Response& res, const httplib::Request& req,
         bool isUndo) {
        json body;
        try {
          body = json::parse(req.body);
        } catch (...) {
          respondError(res, 400, "请求体不是有效 JSON");
          return;
        }
        auto workId = body.value("workId", "");
        PngMetrics metrics;
        std::string error;
        bool ok = isUndo ? WorkSession::undo(workId, metrics, error)
                         : WorkSession::redo(workId, metrics, error);
        if (!ok) {
          respondError(res, 400, error);
          return;
        }
        bool canUndo = false;
        bool canRedo = false;
        WorkSession::state(workId, canUndo, canRedo);
        json response = {
            {"ok", true},
            {"metrics", pngMetricsToJson(metrics)},
            {"canUndo", canUndo},
            {"canRedo", canRedo},
        };
        respondJson(res, std::move(response));
      };

  server_.Post("/api/skin/image/local/undo",
               [localHistoryEndpoint](const httplib::Request& req,
                                      httplib::Response& res) {
                 localHistoryEndpoint(res, req, true);
               });

  server_.Post("/api/skin/image/local/redo",
               [localHistoryEndpoint](const httplib::Request& req,
                                      httplib::Response& res) {
                 localHistoryEndpoint(res, req, false);
               });

  server_.Post("/api/skin/image/save-working",
               [](const httplib::Request& req, httplib::Response& res) {
                 json body;
                 try {
                   body = json::parse(req.body);
                 } catch (...) {
                   respondError(res, 400, "请求体不是有效 JSON");
                   return;
                 }
                 auto workId = body.value("workId", "");
                 auto pathText = body.value("path", "");
                 auto name = body.value("name", "");
                 auto targetName = body.value("targetName", name);
                 if (workId.empty() || pathText.empty() || name.empty() ||
                     targetName.empty()) {
                   respondError(res, 400, "缺少 workId、path 或 name");
                   return;
                 }
                 std::filesystem::path workPath;
                 if (!WorkSession::workingPath(workId, workPath)) {
                   respondError(res, 404, "工作会话不存在");
                   return;
                 }
                 auto skinDir = pathFromUtf8(pathText);
                 if (!isDirectory(skinDir)) {
                   respondError(res, 400, "path 不是有效目录");
                   return;
                 }
                 auto target = resolveWithinRoot(skinDir, targetName);
                 if (!target || !PngTool::isPngName(*target)) {
                   respondError(res, 400, "目标图片路径无效");
                   return;
                 }
                 PngEditOptions options;
                 options.topMargin = body.value("top", -1);
                 options.leftMargin = body.value("left", -1);
                 options.rightMargin = body.value("right", -1);
                 options.alphaScalePercent =
                     body.value("alphaScalePercent", 100);
                 options.alphaValue = body.value("alphaValue", -1);

                 std::optional<std::filesystem::path> backup;
                 auto sourceOnDisk = resolveWithinRoot(skinDir, name);
                 if (sourceOnDisk && target->lexically_normal() ==
                                         sourceOnDisk->lexically_normal()) {
                   auto backupPath = *target;
                   backupPath += L".bak";
                   if (!CopyFileW(target->c_str(), backupPath.c_str(), FALSE)) {
                     respondError(res, 500, "创建图片备份失败");
                     return;
                   }
                   backup = backupPath;
                 }

                 PngMetrics metrics;
                 std::string error;
                 if (!PngTool::edit(workPath, *target, options, metrics,
                                    error)) {
                   respondError(res, 400, error);
                   return;
                 }
                 json response = {{"ok", true},
                                  {"name", targetName},
                                  {"metrics", pngMetricsToJson(metrics)}};
                 if (backup) {
                   response["backup"] = pathToUtf8(*backup);
                 }
                 respondJson(res, std::move(response));
               });

  server_.Post("/api/skin/validate",
               [](const httplib::Request& req, httplib::Response& res) {
                 json body;
                 try {
                   body = json::parse(req.body);
                 } catch (...) {
                   respondError(res, 400, "请求体不是有效 JSON");
                   return;
                 }
                 auto pathText = body.value("path", "");
                 auto skinDir = pathFromUtf8(pathText);
                 if (!isDirectory(skinDir)) {
                   respondError(res, 400, "path 不是有效目录");
                   return;
                 }
                 IniDocument document;
                 std::string raw;
                 std::string error;
                 if (!loadSkinIni(skinDir, document, raw, error)) {
                   respondError(res, 500, error);
                   return;
                 }
                 std::vector<std::string> warnings = collectWarnings(document);
                 for (const auto& block : document.maniaBlocks()) {
                   if (!block.keys) {
                     continue;
                   }
                   for (size_t idx : block.entryIndices) {
                     const IniLine& line = document.lines()[idx];
                     const FieldSpec* field =
                         findFieldForConcreteKey(line.key);
                     if (!field) {
                       continue;
                     }
                     std::string fieldError;
                     if (!validateFieldValue(*field, *block.keys, line.value,
                                             fieldError)) {
                       warnings.push_back("Keys=" +
                                          std::to_string(*block.keys) + " 的 " +
                                          line.key + "：" + fieldError);
                     }
                   }
                 }
                 respondJson(res, {{"warnings", warnings}});
               });

  server_.Post("/api/skin/clone",
               [this](const httplib::Request& req, httplib::Response& res) {
                 json body;
                 try {
                   body = json::parse(req.body);
                 } catch (...) {
                   respondError(res, 400, "请求体不是有效 JSON");
                   return;
                 }
                 auto pathText = body.value("path", "");
                 if (pathText.empty()) {
                   respondError(res, 400, "缺少 path");
                   return;
                 }
                 auto skinDir = pathFromUtf8(pathText);
                 std::string newName;
                 std::string error;
                 if (!this->opsManager_.clone(skinDir, newName, error)) {
                   respondError(res, 400, error);
                   return;
                 }
                 auto state = this->opsManager_.state();
                 respondJson(res,
                             {{"ok", true},
                              {"name", newName},
                              {"path", pathToUtf8(
                                           skinDir.parent_path() /
                                           pathFromUtf8(newName))},
                              {"canUndo", state.canUndo},
                              {"canRedo", state.canRedo}});
               });

  server_.Post("/api/skin/rename",
               [this](const httplib::Request& req, httplib::Response& res) {
                 json body;
                 try {
                   body = json::parse(req.body);
                 } catch (...) {
                   respondError(res, 400, "请求体不是有效 JSON");
                   return;
                 }
                 auto pathText = body.value("path", "");
                 auto newName = body.value("newName", "");
                 if (pathText.empty() || newName.empty()) {
                   respondError(res, 400, "缺少 path 或 newName");
                   return;
                 }
                 std::string newPath;
                 std::string error;
                 if (!this->opsManager_.rename(pathFromUtf8(pathText), newName,
                                               newPath, error)) {
                   respondError(res, 400, error);
                   return;
                 }
                 auto state = this->opsManager_.state();
                 respondJson(res,
                             {{"ok", true},
                              {"name", newName},
                              {"path", newPath},
                              {"canUndo", state.canUndo},
                              {"canRedo", state.canRedo}});
               });

  server_.Post("/api/skin/delete",
               [this](const httplib::Request& req, httplib::Response& res) {
                 json body;
                 try {
                   body = json::parse(req.body);
                 } catch (...) {
                   respondError(res, 400, "请求体不是有效 JSON");
                   return;
                 }
                 auto pathText = body.value("path", "");
                 if (pathText.empty()) {
                   respondError(res, 400, "缺少 path");
                   return;
                 }
                 std::string error;
                 if (!this->opsManager_.removeToRecycleBin(
                         pathFromUtf8(pathText), error)) {
                   respondError(res, 500, error);
                   return;
                 }
                 auto state = this->opsManager_.state();
                 respondJson(res,
                             {{"ok", true},
                              {"canUndo", state.canUndo},
                              {"canRedo", state.canRedo}});
               });

  server_.Post("/api/skin/undo",
               [this](const httplib::Request&, httplib::Response& res) {
                 std::string error;
                 if (!this->opsManager_.undo(error)) {
                   respondError(res, 400, error);
                   return;
                 }
                 auto state = this->opsManager_.state();
                 respondJson(res,
                             {{"ok", true},
                              {"canUndo", state.canUndo},
                              {"canRedo", state.canRedo}});
               });

  server_.Post("/api/skin/redo",
               [this](const httplib::Request&, httplib::Response& res) {
                 std::string error;
                 if (!this->opsManager_.redo(error)) {
                   respondError(res, 400, error);
                   return;
                 }
                 auto state = this->opsManager_.state();
                 respondJson(res,
                             {{"ok", true},
                              {"canUndo", state.canUndo},
                              {"canRedo", state.canRedo}});
               });

  server_.Get("/api/skin/ops",
              [this](const httplib::Request&, httplib::Response& res) {
                auto state = this->opsManager_.state();
                respondJson(res,
                            {{"canUndo", state.canUndo},
                             {"canRedo", state.canRedo},
                             {"undoLabel", state.undoLabel},
                             {"redoLabel", state.redoLabel}});
              });

  server_.Get("/api/skin/styles",
              [](const httplib::Request& req, httplib::Response& res) {
                auto skinDir = skinDirFromParam(req, res);
                if (!skinDir) {
                  return;
                }
                respondJson(res,
                            {{"path", pathToUtf8(*skinDir)},
                             {"styles", StyleProfile::load(*skinDir)}});
              });

  server_.Post("/api/skin/styles/save",
               [](const httplib::Request& req, httplib::Response& res) {
                 json body;
                 try {
                   body = json::parse(req.body);
                 } catch (...) {
                   respondError(res, 400, "请求体不是有效 JSON");
                   return;
                 }
                 auto pathText = body.value("path", "");
                 auto name = body.value("name", "");
                 auto keys = body.value("keys", -1);
                 if (pathText.empty() || name.empty() ||
                     !body.contains("values") || !body["values"].is_object()) {
                   respondError(res, 400, "缺少 path、name 或 values");
                   return;
                 }
                 std::string error;
                 if (!StyleProfile::saveStyle(pathFromUtf8(pathText), keys,
                                              name, body["values"], error)) {
                   respondError(res, 400, error);
                   return;
                 }
                 respondJson(res,
                             {{"ok", true},
                              {"styles",
                               StyleProfile::load(pathFromUtf8(pathText))}});
               });

  server_.Post("/api/skin/styles/delete",
               [](const httplib::Request& req, httplib::Response& res) {
                 json body;
                 try {
                   body = json::parse(req.body);
                 } catch (...) {
                   respondError(res, 400, "请求体不是有效 JSON");
                   return;
                 }
                 auto pathText = body.value("path", "");
                 auto name = body.value("name", "");
                 auto keys = body.value("keys", -1);
                 if (pathText.empty() || name.empty()) {
                   respondError(res, 400, "缺少 path 或 name");
                   return;
                 }
                 std::string error;
                 if (!StyleProfile::deleteStyle(pathFromUtf8(pathText), keys,
                                                name, error)) {
                   respondError(res, 400, error);
                   return;
                 }
                 respondJson(res,
                             {{"ok", true},
                              {"styles",
                               StyleProfile::load(pathFromUtf8(pathText))}});
               });

  server_.Post("/api/skin/styles/rename",
               [](const httplib::Request& req, httplib::Response& res) {
                 json body;
                 try {
                   body = json::parse(req.body);
                 } catch (...) {
                   respondError(res, 400, "请求体不是有效 JSON");
                   return;
                 }
                 auto pathText = body.value("path", "");
                 auto oldName = body.value("oldName", "");
                 auto newName = body.value("newName", "");
                 auto keys = body.value("keys", -1);
                 if (pathText.empty() || oldName.empty() || newName.empty()) {
                   respondError(res, 400, "缺少 path、oldName 或 newName");
                   return;
                 }
                 std::string error;
                 if (!StyleProfile::renameStyle(pathFromUtf8(pathText), keys,
                                                oldName, newName, error)) {
                   respondError(res, 400, error);
                   return;
                 }
                 respondJson(res,
                             {{"ok", true},
                              {"styles",
                               StyleProfile::load(pathFromUtf8(pathText))}});
               });

  server_.Put("/api/skin/mania",
              [](const httplib::Request& req, httplib::Response& res) {
                json body;
                try {
                  body = json::parse(req.body);
                } catch (...) {
                  respondError(res, 400, "请求体不是有效 JSON");
                  return;
                }
                auto pathText = body.value("path", "");
                if (pathText.empty()) {
                  respondError(res, 400, "缺少 path");
                  return;
                }
                auto keys = body.value("keys", -1);
                if (!isValidKeysValue(keys)) {
                  respondError(res, 400, "keys 无效");
                  return;
                }
                auto skinDir = pathFromUtf8(pathText);
                if (!isDirectory(skinDir)) {
                  respondError(res, 400, "path 不是有效目录");
                  return;
                }
                IniDocument document;
                std::string raw;
                std::string error;
                if (!loadSkinIni(skinDir, document, raw, error)) {
                  respondError(res, 500, error);
                  return;
                }

                if (!body.contains("updates") || !body["updates"].is_array()) {
                  respondError(res, 400, "缺少 updates 数组");
                  return;
                }
                std::vector<FieldUpdate> updates;
                std::vector<std::string> errors;
                bool needsVersion25 = false;
                for (const auto& item : body["updates"]) {
                  auto key = item.value("key", "");
                  auto value = item.value("value", "");
                  if (iequalsAscii(key, "Keys") &&
                      value != std::to_string(keys)) {
                    errors.push_back("Keys 不可修改，请切换到对应键数模块");
                    continue;
                  }
                  const FieldSpec* field = findFieldForConcreteKey(key);
                  if (!field) {
                    errors.push_back("未知参数：" + key);
                    continue;
                  }
                  std::string fieldError;
                  if (!validateFieldValue(*field, keys, value, fieldError)) {
                    errors.push_back(key + "：" + fieldError);
                    continue;
                  }
                  needsVersion25 = needsVersion25 || field->requiresVersion25;
                  updates.push_back({key, value});
                }
                if (!errors.empty()) {
                  respondJson(res, {{"error", "参数校验失败"},
                                    {"errors", errors}},
                              400);
                  return;
                }

                if (needsVersion25) {
                  auto version = document.generalVersion();
                  if (!version || !isVersionAtLeast25(*version)) {
                    document.setGeneralVersion("latest");
                  }
                }
                std::vector<std::string> applyErrors;
                if (!document.applyManiaUpdates(keys, updates, applyErrors)) {
                  respondError(res, 400, applyErrors.front());
                  return;
                }

                auto iniPath = skinDir / "skin.ini";
                auto backupPath = skinDir / "skin.ini.bak";
                if (!CopyFileW(iniPath.c_str(), backupPath.c_str(), FALSE)) {
                  respondError(res, 500,
                               "创建备份 skin.ini.bak 失败");
                  return;
                }

                std::string serialized = document.serialize();
                auto tmpPath = skinDir / "skin.ini.tmp";
                if (!writeFileBinary(tmpPath, serialized)) {
                  std::error_code ec;
                  std::filesystem::remove(tmpPath, ec);
                  respondError(res, 500, "写入临时文件失败");
                  return;
                }
                if (!MoveFileExW(tmpPath.c_str(), iniPath.c_str(),
                                 MOVEFILE_REPLACE_EXISTING |
                                     MOVEFILE_WRITE_THROUGH)) {
                  std::error_code ec;
                  std::filesystem::remove(tmpPath, ec);
                  respondError(res, 500, "替换 skin.ini 失败");
                  return;
                }

                json version = nullptr;
                if (auto v = document.generalVersion()) {
                  version = *v;
                }
                respondJson(res,
                            {{"ok", true},
                             {"backup", pathToUtf8(backupPath)},
                             {"version", version},
                             {"warnings", collectWarnings(document)}});
              });

  server_.Get("/", [this](const httplib::Request&, httplib::Response& res) {
    std::string body;
    if (loadEmbeddedFile("index.html", body)) {
      res.set_content(body, "text/html; charset=utf-8");
      res.set_header("Cache-Control", "no-cache");
      return;
    }
    auto file = dist_dir_ / "index.html";
    if (isRegularFile(file)) {
      res.set_content(readFileBinary(file), "text/html; charset=utf-8");
      res.set_header("Cache-Control", "no-cache");
      return;
    }
    res.status = 404;
    res.set_content("前端资源未构建，请先运行 npm run build",
                    "text/plain; charset=utf-8");
  });

  server_.Get(R"(/(.*))",
              [this](const httplib::Request& req, httplib::Response& res) {
                std::string urlPath = req.matches[1].str();
                if (urlPath.empty()) {
                  res.status = 404;
                  res.set_content("not found", "text/plain");
                  return;
                }
                std::string body;
                if (loadEmbeddedFile(urlPath, body)) {
                  res.set_content(body, mimeForExtension(urlPath));
                  res.set_header("Cache-Control", "public, max-age=31536000");
                  return;
                }
                auto file = dist_dir_ / pathFromUtf8(urlPath);
                std::error_code ec;
                auto canonicalFile = std::filesystem::weakly_canonical(file, ec);
                auto canonicalDist =
                    std::filesystem::weakly_canonical(dist_dir_, ec);
                auto relative =
                    canonicalFile.lexically_relative(canonicalDist);
                bool inside = !ec && !relative.empty() &&
                              *relative.begin() != "..";
                if (inside && isRegularFile(file)) {
                  res.set_content(readFileBinary(file),
                                  mimeForExtension(urlPath));
                  return;
                }
                res.status = 404;
                res.set_content("not found", "text/plain");
              });
}

}  // namespace mania
