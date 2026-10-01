#include "image/work_session.h"

#include <windows.h>

#include <algorithm>
#include <atomic>
#include <filesystem>
#include <map>
#include <mutex>
#include <string>
#include <vector>

#include "skins/skin_scanner.h"

namespace mania {

namespace work_session_detail {

struct SessionRecord {
  std::filesystem::path dir;
  std::filesystem::path workFile;
  int undoCount = 0;
  int redoCount = 0;
};

std::mutex gMutex;
std::map<std::string, SessionRecord> gSessions;
std::atomic<unsigned> gCounter{0};

std::filesystem::path root() {
  return std::filesystem::temp_directory_path() / L"ManiaSkinWorking";
}

std::string nextId() {
  return std::to_string(GetTickCount64()) + "_" +
         std::to_string(gCounter.fetch_add(1));
}

bool getLocked(const std::string& id, SessionRecord& out) {
  auto it = gSessions.find(id);
  if (it == gSessions.end()) {
    return false;
  }
  out = it->second;
  return true;
}

void trimLocked() {
  while (gSessions.size() > 20) {
    gSessions.erase(gSessions.begin());
  }
}

std::filesystem::path undoPath(const SessionRecord& record, int index) {
  return record.dir / ("undo_" + std::to_string(index) + ".png");
}

std::filesystem::path redoPath(const SessionRecord& record, int index) {
  return record.dir / ("redo_" + std::to_string(index) + ".png");
}

bool copyFile(const std::filesystem::path& source,
              const std::filesystem::path& target) {
  return CopyFileW(source.c_str(), target.c_str(), FALSE) != 0;
}

bool clearRedoFilesLocked(const SessionRecord& record) {
  for (int i = 0; i < record.redoCount; ++i) {
    std::error_code ec;
    std::filesystem::remove(redoPath(record, i), ec);
  }
  return true;
}

bool analyzeSessionFile(const std::filesystem::path& path,
                        PngMetrics& metrics, std::string& error) {
  return PngTool::analyze(path, metrics, error);
}

}  // namespace work_session_detail

bool WorkSession::start(const std::filesystem::path& skinDir,
                        const std::string& name, std::string& workId,
                        PngMetrics& metrics, std::string& error) {
  auto resolved = resolveWithinRoot(skinDir, name);
  if (!resolved || !PngTool::isPngName(*resolved)) {
    error = "图片路径无效或不是 PNG";
    return false;
  }
  PngMetrics check;
  if (!PngTool::analyze(*resolved, check, error)) {
    return false;
  }

  std::lock_guard lock(work_session_detail::gMutex);
  workId = work_session_detail::nextId();
  work_session_detail::SessionRecord record;
  record.dir = work_session_detail::root() /
               pathFromUtf8(workId);
  std::error_code ec;
  std::filesystem::create_directories(record.dir, ec);
  if (ec) {
    error = "创建工作目录失败";
    return false;
  }
  record.workFile = record.dir / "work.png";
  if (!work_session_detail::copyFile(*resolved, record.workFile)) {
    error = "复制工作图片失败";
    return false;
  }
  work_session_detail::gSessions[workId] = record;
  work_session_detail::trimLocked();
  metrics = check;
  return true;
}

bool WorkSession::transform(const std::string& workId,
                            const ImageRect& source,
                            const ImageRect& target, PngMetrics& metrics,
                            std::string& error) {
  std::lock_guard lock(work_session_detail::gMutex);
  auto it = work_session_detail::gSessions.find(workId);
  if (it == work_session_detail::gSessions.end()) {
    error = "工作会话不存在";
    return false;
  }
  auto& record = it->second;
  int width = 0;
  int height = 0;
  std::vector<unsigned char> pixels;
  if (!PngTool::decode(record.workFile, pixels, width, height, error)) {
    return false;
  }

  auto clampRect = [&](ImageRect rect, const char* label) -> bool {
    rect.x0 = std::max(0, std::min(width - 1, rect.x0));
    rect.y0 = std::max(0, std::min(height - 1, rect.y0));
    rect.x1 = std::max(0, std::min(width - 1, rect.x1));
    rect.y1 = std::max(0, std::min(height - 1, rect.y1));
    if (rect.x0 > rect.x1) {
      std::swap(rect.x0, rect.x1);
    }
    if (rect.y0 > rect.y1) {
      std::swap(rect.y0, rect.y1);
    }
    if (rect.x1 < 0 || rect.y1 < 0) {
      error = std::string(label) + " 选区无效";
      return false;
    }
    return true;
  };

  ImageRect sourceClamped = source;
  ImageRect targetClamped = target;
  if (!clampRect(sourceClamped, "源") || !clampRect(targetClamped, "目标")) {
    return false;
  }

  int sourceWidth = sourceClamped.x1 - sourceClamped.x0 + 1;
  int sourceHeight = sourceClamped.y1 - sourceClamped.y0 + 1;
  int targetWidth = targetClamped.x1 - targetClamped.x0 + 1;
  int targetHeight = targetClamped.y1 - targetClamped.y0 + 1;

  std::vector<unsigned char> output = pixels;
  for (int y = sourceClamped.y0; y <= sourceClamped.y1; ++y) {
    for (int x = sourceClamped.x0; x <= sourceClamped.x1; ++x) {
      size_t clearIndex =
          (static_cast<size_t>(y) * width + static_cast<size_t>(x)) * 4;
      output[clearIndex] = 0;
      output[clearIndex + 1] = 0;
      output[clearIndex + 2] = 0;
      output[clearIndex + 3] = 0;
    }
  }
  for (int ty = targetClamped.y0; ty <= targetClamped.y1; ++ty) {
    double syFloat =
        sourceClamped.y0 +
        (ty - targetClamped.y0 + 0.5) * static_cast<double>(sourceHeight) /
            static_cast<double>(targetHeight) -
        0.5;
    int sy = static_cast<int>(syFloat + 0.5);
    sy = std::max(sourceClamped.y0,
                  std::min(sourceClamped.y1, sy));
    for (int tx = targetClamped.x0; tx <= targetClamped.x1; ++tx) {
      double sxFloat =
          sourceClamped.x0 +
          (tx - targetClamped.x0 + 0.5) *
              static_cast<double>(sourceWidth) /
              static_cast<double>(targetWidth) -
          0.5;
      int sx = static_cast<int>(sxFloat + 0.5);
      sx = std::max(sourceClamped.x0,
                    std::min(sourceClamped.x1, sx));
      size_t srcIndex =
          (static_cast<size_t>(sy) * width + static_cast<size_t>(sx)) * 4;
      size_t dstIndex =
          (static_cast<size_t>(ty) * width + static_cast<size_t>(tx)) * 4;
      output[dstIndex] = pixels[srcIndex];
      output[dstIndex + 1] = pixels[srcIndex + 1];
      output[dstIndex + 2] = pixels[srcIndex + 2];
      output[dstIndex + 3] = pixels[srcIndex + 3];
    }
  }

  auto undoFile = work_session_detail::undoPath(record, record.undoCount);
  if (!work_session_detail::copyFile(record.workFile, undoFile)) {
    error = "写入撤销快照失败";
    return false;
  }
  if (!PngTool::encode(record.workFile, width, height, output, error)) {
    return false;
  }
  record.undoCount++;
  work_session_detail::clearRedoFilesLocked(record);
  record.redoCount = 0;
  return work_session_detail::analyzeSessionFile(record.workFile, metrics,
                                                 error);
}

bool WorkSession::drawLine(const std::string& workId,
                           const PngLineOptions& options, PngMetrics& metrics,
                           std::string& error) {
  std::lock_guard lock(work_session_detail::gMutex);
  auto it = work_session_detail::gSessions.find(workId);
  if (it == work_session_detail::gSessions.end()) {
    error = "工作会话不存在";
    return false;
  }
  auto& record = it->second;
  auto undoFile = work_session_detail::undoPath(record, record.undoCount);
  if (!work_session_detail::copyFile(record.workFile, undoFile)) {
    error = "写入撤销快照失败";
    return false;
  }
  if (!PngTool::drawLine(record.workFile, record.workFile, options, metrics,
                         error)) {
    return false;
  }
  record.undoCount++;
  work_session_detail::clearRedoFilesLocked(record);
  record.redoCount = 0;
  return true;
}

bool WorkSession::contentProfile(const std::string& workId,
                                 PngContentProfile& profile,
                                 std::string& error) {
  std::lock_guard lock(work_session_detail::gMutex);
  auto it = work_session_detail::gSessions.find(workId);
  if (it == work_session_detail::gSessions.end()) {
    error = "工作会话不存在";
    return false;
  }
  return PngTool::contentProfile(it->second.workFile, profile, error);
}

bool WorkSession::undo(const std::string& workId, PngMetrics& metrics,
                       std::string& error) {
  std::lock_guard lock(work_session_detail::gMutex);
  auto it = work_session_detail::gSessions.find(workId);
  if (it == work_session_detail::gSessions.end()) {
    error = "工作会话不存在";
    return false;
  }
  auto& record = it->second;
  if (record.undoCount <= 0) {
    error = "没有可撤销的变换";
    return false;
  }
  auto target = work_session_detail::undoPath(record, record.undoCount - 1);
  auto redoFile = work_session_detail::redoPath(record, record.redoCount);
  if (!work_session_detail::copyFile(record.workFile, redoFile) ||
      !work_session_detail::copyFile(target, record.workFile)) {
    error = "撤销失败";
    return false;
  }
  record.undoCount--;
  record.redoCount++;
  return work_session_detail::analyzeSessionFile(record.workFile, metrics,
                                                 error);
}

bool WorkSession::redo(const std::string& workId, PngMetrics& metrics,
                       std::string& error) {
  std::lock_guard lock(work_session_detail::gMutex);
  auto it = work_session_detail::gSessions.find(workId);
  if (it == work_session_detail::gSessions.end()) {
    error = "工作会话不存在";
    return false;
  }
  auto& record = it->second;
  if (record.redoCount <= 0) {
    error = "没有可重做的变换";
    return false;
  }
  auto target = work_session_detail::redoPath(record, record.redoCount - 1);
  auto undoFile = work_session_detail::undoPath(record, record.undoCount);
  if (!work_session_detail::copyFile(record.workFile, undoFile) ||
      !work_session_detail::copyFile(target, record.workFile)) {
    error = "重做失败";
    return false;
  }
  record.redoCount--;
  record.undoCount++;
  return work_session_detail::analyzeSessionFile(record.workFile, metrics,
                                                 error);
}

bool WorkSession::state(const std::string& workId, bool& canUndo,
                        bool& canRedo) {
  std::lock_guard lock(work_session_detail::gMutex);
  work_session_detail::SessionRecord record;
  if (!work_session_detail::getLocked(workId, record)) {
    return false;
  }
  canUndo = record.undoCount > 0;
  canRedo = record.redoCount > 0;
  return true;
}

bool WorkSession::workingPath(const std::string& workId,
                              std::filesystem::path& path) {
  std::lock_guard lock(work_session_detail::gMutex);
  work_session_detail::SessionRecord record;
  if (!work_session_detail::getLocked(workId, record)) {
    return false;
  }
  path = record.workFile;
  return true;
}

}  // namespace mania
