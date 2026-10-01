#pragma once

#include <filesystem>
#include <string>

#include "image/png_tool.h"

namespace mania {

struct ImageRect {
  int x0 = 0;
  int y0 = 0;
  int x1 = 0;
  int y1 = 0;
};

class WorkSession {
 public:
  static bool start(const std::filesystem::path& skinDir,
                    const std::string& name, std::string& workId,
                    PngMetrics& metrics, std::string& error);

  static bool transform(const std::string& workId,
                        const ImageRect& source,
                        const ImageRect& target, PngMetrics& metrics,
                        std::string& error);

  static bool drawLine(const std::string& workId,
                       const PngLineOptions& options, PngMetrics& metrics,
                       std::string& error);

  static bool contentProfile(const std::string& workId,
                             PngContentProfile& profile, std::string& error);

  static bool undo(const std::string& workId, PngMetrics& metrics,
                   std::string& error);
  static bool redo(const std::string& workId, PngMetrics& metrics,
                   std::string& error);

  static bool state(const std::string& workId, bool& canUndo,
                    bool& canRedo);

  static bool workingPath(const std::string& workId,
                          std::filesystem::path& path);
};

}  // namespace mania
