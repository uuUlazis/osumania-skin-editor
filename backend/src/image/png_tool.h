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

// 单边线参数：position 是这条线最外侧（靠画布边缘）的坐标，
// left/right 时为 x，top/bottom 时为 y；线从该坐标向画布内部延伸 width 像素。
struct PngLineOptions {
  int side = 0;      // 0=上 1=下 2=左 3=右
  int position = -1; // 最外侧坐标（像素）
  int width = 1;     // 线宽（像素）
  int r = 255;       // 0..255
  int g = 255;
  int b = 255;
  int a = 255;
};

// 面身轮廓数据：供前端做位置吸附，避免在浏览器里解析整张贴图
// （面条身贴图常高达数万像素，浏览器 canvas 不可靠）。
struct PngContentProfile {
  bool valid = false;
  int width = 0;
  int height = 0;
  bool hasContent = false;
  int minX = 0;   // 不透明像素包围盒
  int maxX = -1;
  int minY = 0;
  int maxY = -1;
  std::vector<int> leftEdges;   // 每行最左不透明像素 x（去重升序）
  std::vector<int> rightEdges;  // 每行最右不透明像素 x（去重升序）
  std::vector<int> topEdges;    // 每列最上不透明像素 y（去重升序）
  std::vector<int> bottomEdges; // 每列最下不透明像素 y（去重升序）
};

class PngTool {
 public:
  static bool analyze(const std::filesystem::path& path, PngMetrics& metrics,
                      std::string& error);
  static bool edit(const std::filesystem::path& source,
                   const std::filesystem::path& target,
                   const PngEditOptions& options, PngMetrics& metrics,
                   std::string& error);
  static bool drawLine(const std::filesystem::path& source,
                       const std::filesystem::path& target,
                       const PngLineOptions& options, PngMetrics& metrics,
                       std::string& error);
  static bool contentProfile(const std::filesystem::path& path,
                             PngContentProfile& profile, std::string& error);
  static bool decode(const std::filesystem::path& path,
                     std::vector<unsigned char>& rgba, int& width,
                     int& height, std::string& error);
  static bool encode(const std::filesystem::path& path, int width, int height,
                     const std::vector<unsigned char>& rgba,
                     std::string& error);
  static bool isPngName(const std::filesystem::path& path);
};

}  // namespace mania
