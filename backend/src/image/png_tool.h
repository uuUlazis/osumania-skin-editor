#pragma once

#include <filesystem>
#include <string>
#include <vector>

namespace mania {

struct PngMetrics {
  bool valid = false;
  int width = 0;
  int height = 0;
  int topSpacing = 0;     // rows above the first visible pixel
  int leftSpacing = 0;    // columns left of the first visible pixel
  int rightSpacing = 0;   // columns right of the last visible pixel
  int bottomSpacing = 0;  // rows below the last visible pixel
  int minAlpha = 255;
  int maxAlpha = 0;
  long long fullyTransparentCount = 0;
  long long fullyOpaqueCount = 0;
  long long totalPixels = 0;
};

struct PngEditOptions {
  int topMargin = -1;   // target top spacing; -1 keeps current
  int leftMargin = -1;  // target left spacing; -1 keeps current
  int rightMargin = -1; // target right spacing; -1 keeps current
  int alphaScalePercent = 100; // 100 = unchanged, 0..1000
  int alphaValue = -1;  // >= 0 forces every pixel alpha to this value
};

class PngTool {
 public:
  static bool analyze(const std::filesystem::path& path, PngMetrics& metrics,
                      std::string& error);
  static bool edit(const std::filesystem::path& source,
                   const std::filesystem::path& target,
                   const PngEditOptions& options, PngMetrics& metrics,
                   std::string& error);
  static bool decode(const std::filesystem::path& path,
                     std::vector<unsigned char>& rgba, int& width,
                     int& height, std::string& error);
  static bool encode(const std::filesystem::path& path, int width, int height,
                     const std::vector<unsigned char>& rgba,
                     std::string& error);
  static bool isPngName(const std::filesystem::path& path);
};

}  // namespace mania
