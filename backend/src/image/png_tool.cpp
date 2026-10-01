#include "image/png_tool.h"

#include <windows.h>

#include <algorithm>
#include <cctype>
#include <fstream>
#include <iterator>
#include <sstream>
#include <vector>

#include "stb/stb_image.h"
#include "stb/stb_image_write.h"

namespace mania {

namespace {

bool readBinary(const std::filesystem::path& path,
                std::vector<unsigned char>& out, std::string& error) {
  std::ifstream stream(path, std::ios::binary);
  if (!stream) {
    error = "无法读取图片文件";
    return false;
  }
  out.assign(std::istreambuf_iterator<char>(stream),
             std::istreambuf_iterator<char>());
  if (out.empty()) {
    error = "图片文件为空";
    return false;
  }
  return true;
}

struct MemoryWriter {
  std::vector<unsigned char> data;
};

void appendToMemory(void* context, void* data, int size) {
  auto* writer = static_cast<MemoryWriter*>(context);
  auto* bytes = static_cast<const unsigned char*>(data);
  writer->data.insert(writer->data.end(), bytes, bytes + size);
}

bool writeBinary(const std::filesystem::path& path,
                 const std::vector<unsigned char>& data,
                 std::string& error) {
  auto tmp = path;
  tmp += ".tmp";
  std::ofstream stream(tmp, std::ios::binary | std::ios::trunc);
  if (!stream) {
    error = "无法写入图片文件";
    return false;
  }
  stream.write(reinterpret_cast<const char*>(data.data()),
               static_cast<std::streamsize>(data.size()));
  stream.flush();
  stream.close();
  if (!stream) {
    error = "写入图片文件失败";
    return false;
  }
  if (!MoveFileExW(tmp.c_str(), path.c_str(),
                   MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
    error = "替换图片文件失败";
    return false;
  }
  return true;
}

std::string lowerExtension(const std::filesystem::path& path) {
  auto name = path.filename().string();
  auto dot = name.rfind('.');
  if (dot == std::string::npos) {
    return {};
  }
  std::string ext = name.substr(dot);
  std::transform(ext.begin(), ext.end(), ext.begin(),
                 [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return ext;
}

}  // namespace

bool PngTool::isPngName(const std::filesystem::path& path) {
  return lowerExtension(path) == ".png";
}

bool PngTool::analyze(const std::filesystem::path& path, PngMetrics& metrics,
                      std::string& error) {
  std::vector<unsigned char> bytes;
  if (!readBinary(path, bytes, error)) {
    return false;
  }
  int width = 0;
  int height = 0;
  int channels = 0;
  unsigned char* pixels = stbi_load_from_memory(
      bytes.data(), static_cast<int>(bytes.size()), &width, &height, &channels,
      4);
  if (!pixels) {
    error = "无法解析 PNG 图片";
    return false;
  }

  PngMetrics result;
  result.valid = true;
  result.width = width;
  result.height = height;
  result.totalPixels =
      static_cast<long long>(width) * static_cast<long long>(height);

  int minX = width;
  int maxX = -1;
  int minY = height;
  int maxY = -1;
  int minAlpha = 255;
  int maxAlpha = 0;
  long long transparent = 0;
  long long opaque = 0;

  for (int y = 0; y < height; ++y) {
    for (int x = 0; x < width; ++x) {
      const unsigned char* pixel =
          pixels + (y * width + x) * 4;
      int alpha = pixel[3];
      minAlpha = std::min(minAlpha, alpha);
      maxAlpha = std::max(maxAlpha, alpha);
      if (alpha == 0) {
        ++transparent;
      } else if (alpha == 255) {
        ++opaque;
        minX = std::min(minX, x);
        maxX = std::max(maxX, x);
        minY = std::min(minY, y);
        maxY = std::max(maxY, y);
      } else {
        minX = std::min(minX, x);
        maxX = std::max(maxX, x);
        minY = std::min(minY, y);
        maxY = std::max(maxY, y);
      }
    }
  }
  stbi_image_free(pixels);

  result.minAlpha = minAlpha;
  result.maxAlpha = maxAlpha;
  result.fullyTransparentCount = transparent;
  result.fullyOpaqueCount = opaque;
  if (maxX >= 0) {
    result.topSpacing = minY;
    result.leftSpacing = minX;
    result.rightSpacing = width - 1 - maxX;
    result.bottomSpacing = height - 1 - maxY;
  }
  metrics = result;
  return true;
}

bool PngTool::decode(const std::filesystem::path& path,
                     std::vector<unsigned char>& rgba, int& width,
                     int& height, std::string& error) {
  std::vector<unsigned char> bytes;
  if (!readBinary(path, bytes, error)) {
    return false;
  }
  int channels = 0;
  unsigned char* pixels = stbi_load_from_memory(
      bytes.data(), static_cast<int>(bytes.size()), &width, &height, &channels,
      4);
  if (!pixels) {
    error = "无法解析 PNG 图片";
    return false;
  }
  size_t count = static_cast<size_t>(width) * static_cast<size_t>(height) * 4;
  rgba.assign(pixels, pixels + count);
  stbi_image_free(pixels);
  return true;
}

bool PngTool::encode(const std::filesystem::path& path, int width, int height,
                     const std::vector<unsigned char>& rgba,
                     std::string& error) {
  MemoryWriter writer;
  if (!stbi_write_png_to_func(&appendToMemory, &writer, width, height, 4,
                              rgba.data(), 0)) {
    error = "PNG 编码失败";
    return false;
  }
  return writeBinary(path, writer.data, error);
}

bool PngTool::edit(const std::filesystem::path& source,
                   const std::filesystem::path& target,
                   const PngEditOptions& options, PngMetrics& metrics,
                   std::string& error) {
  if (!isPngName(source) || !isPngName(target)) {
    error = "仅支持 PNG 图片";
    return false;
  }
  std::vector<unsigned char> bytes;
  if (!readBinary(source, bytes, error)) {
    return false;
  }
  int width = 0;
  int height = 0;
  int channels = 0;
  unsigned char* sourcePixels = stbi_load_from_memory(
      bytes.data(), static_cast<int>(bytes.size()), &width, &height, &channels,
      4);
  if (!sourcePixels) {
    error = "无法解析 PNG 图片";
    return false;
  }

  int minX = width;
  int maxX = -1;
  int minY = height;
  int maxY = -1;
  for (int y = 0; y < height; ++y) {
    for (int x = 0; x < width; ++x) {
      if (sourcePixels[(y * width + x) * 4 + 3] > 0) {
        minX = std::min(minX, x);
        maxX = std::max(maxX, x);
        minY = std::min(minY, y);
        maxY = std::max(maxY, y);
      }
    }
  }
  if (maxX < 0) {
    stbi_image_free(sourcePixels);
    error = "图片没有可见像素，无法进行留白调整";
    return false;
  }

  int contentWidth = maxX - minX + 1;
  int contentHeight = maxY - minY + 1;
  int currentTop = minY;
  int currentLeft = minX;
  int currentRight = width - 1 - maxX;
  int currentBottom = height - 1 - maxY;

  int top = options.topMargin >= 0 ? options.topMargin : currentTop;
  int left = options.leftMargin >= 0 ? options.leftMargin : currentLeft;
  int right = options.rightMargin >= 0 ? options.rightMargin : currentRight;
  int bottom = currentBottom;

  if (top < 0 || left < 0 || right < 0 || bottom < 0) {
    stbi_image_free(sourcePixels);
    error = "留白数值不能为负数";
    return false;
  }
  long long newWidth = static_cast<long long>(contentWidth) + left + right;
  long long newHeight = static_cast<long long>(contentHeight) + top + bottom;
  // mania long-note bodies are usually very tall strips (tens of thousands of
  // pixels high). Limit on extreme dimensions only to avoid memory exhaustion.
  constexpr long long kMaxDimension = 262144;
  constexpr long long kMaxPixels = 134217728;
  if (newWidth <= 0 || newHeight <= 0 || newWidth > kMaxDimension ||
      newHeight > kMaxDimension || newWidth * newHeight > kMaxPixels) {
    stbi_image_free(sourcePixels);
    error = "调整后的图片尺寸过大或无效";
    return false;
  }

  std::vector<unsigned char> output(
      static_cast<size_t>(newWidth * newHeight * 4), 0);
  for (int y = 0; y < contentHeight; ++y) {
    for (int x = 0; x < contentWidth; ++x) {
      const unsigned char* src =
          sourcePixels + ((minY + y) * width + (minX + x)) * 4;
      unsigned char* dst =
          output.data() + (static_cast<size_t>(top + y) * newWidth +
                           left + x) *
                              4;
      dst[0] = src[0];
      dst[1] = src[1];
      dst[2] = src[2];
      dst[3] = src[3];
    }
  }
  stbi_image_free(sourcePixels);

  if (options.alphaValue >= 0) {
    int value = std::clamp(options.alphaValue, 0, 255);
    for (size_t i = 3; i < output.size(); i += 4) {
      if (output[i] > 0) {
        output[i] = static_cast<unsigned char>(value);
      }
    }
  } else if (options.alphaScalePercent != 100) {
    double scale = static_cast<double>(options.alphaScalePercent) / 100.0;
    for (size_t i = 3; i < output.size(); i += 4) {
      int alpha = static_cast<int>(output[i] * scale + 0.5);
      output[i] = static_cast<unsigned char>(std::clamp(alpha, 0, 255));
    }
  }

  MemoryWriter writer;
  if (!stbi_write_png_to_func(&appendToMemory, &writer,
                              static_cast<int>(newWidth),
                              static_cast<int>(newHeight), 4,
                              output.data(), 0)) {
    error = "PNG 编码失败";
    return false;
  }
  if (!writeBinary(target, writer.data, error)) {
    return false;
  }
  return analyze(target, metrics, error);
}

bool PngTool::drawLine(const std::filesystem::path& source,
                       const std::filesystem::path& target,
                       const PngLineOptions& options, PngMetrics& metrics,
                       std::string& error) {
  if (!isPngName(source) || !isPngName(target)) {
    error = "仅支持 PNG 图片";
    return false;
  }
  if (options.width < 1) {
    error = "线宽必须大于 0";
    return false;
  }
  if (options.side < 0 || options.side > 3) {
    error = "边线方向无效";
    return false;
  }
  if (options.position < 0) {
    error = "边线位置无效";
    return false;
  }
  std::vector<unsigned char> rgba;
  int width = 0;
  int height = 0;
  if (!decode(source, rgba, width, height, error)) {
    return false;
  }
  if (width <= 0 || height <= 0) {
    error = "图片尺寸无效";
    return false;
  }
  const bool vertical = options.side == 2 || options.side == 3;
  const int limit = vertical ? width : height;
  if (options.position >= limit) {
    error = "边线位置超出图片范围";
    return false;
  }

  const unsigned char color[4] = {
      static_cast<unsigned char>(std::clamp(options.r, 0, 255)),
      static_cast<unsigned char>(std::clamp(options.g, 0, 255)),
      static_cast<unsigned char>(std::clamp(options.b, 0, 255)),
      static_cast<unsigned char>(std::clamp(options.a, 0, 255))};
  auto paint = [&](int x, int y) {
    unsigned char* pixel =
        rgba.data() + (static_cast<size_t>(y) * width + x) * 4;
    pixel[0] = color[0];
    pixel[1] = color[1];
    pixel[2] = color[2];
    pixel[3] = color[3];
  };

  const int thickness = std::min(options.width, limit);
  // 上/左：从 position 向画布内侧（右/下）延伸；下/右：从 position 向内（左/上）
  // 延伸 —— position 始终是这条线最外侧的那一像素。
  const bool outwardFirst = options.side == 0 || options.side == 2;
  int from = outwardFirst ? options.position : options.position - thickness + 1;
  int to = outwardFirst ? options.position + thickness - 1 : options.position;
  from = std::max(0, from);
  to = std::min(limit - 1, to);
  for (int index = from; index <= to; ++index) {
    if (vertical) {
      for (int y = 0; y < height; ++y) {
        paint(index, y);
      }
    } else {
      for (int x = 0; x < width; ++x) {
        paint(x, index);
      }
    }
  }

  if (!encode(target, width, height, rgba, error)) {
    return false;
  }
  return analyze(target, metrics, error);
}

bool PngTool::contentProfile(const std::filesystem::path& path,
                             PngContentProfile& profile, std::string& error) {
  if (!isPngName(path)) {
    error = "仅支持 PNG 图片";
    return false;
  }
  std::vector<unsigned char> rgba;
  int width = 0;
  int height = 0;
  if (!decode(path, rgba, width, height, error)) {
    return false;
  }
  if (width <= 0 || height <= 0) {
    error = "图片尺寸无效";
    return false;
  }
  profile = PngContentProfile{};
  profile.valid = true;
  profile.width = width;
  profile.height = height;

  std::vector<int> rowMin(static_cast<size_t>(height), width);
  std::vector<int> rowMax(static_cast<size_t>(height), -1);
  std::vector<int> columnMin(static_cast<size_t>(width), height);
  std::vector<int> columnMax(static_cast<size_t>(width), -1);
  int minX = width;
  int maxX = -1;
  int minY = height;
  int maxY = -1;
  for (int y = 0; y < height; ++y) {
    const unsigned char* row =
        rgba.data() + static_cast<size_t>(y) * width * 4;
    for (int x = 0; x < width; ++x) {
      if (row[static_cast<size_t>(x) * 4 + 3] == 0) {
        continue;
      }
      if (x < rowMin[static_cast<size_t>(y)]) rowMin[static_cast<size_t>(y)] = x;
      if (x > rowMax[static_cast<size_t>(y)]) rowMax[static_cast<size_t>(y)] = x;
      if (y < columnMin[static_cast<size_t>(x)])
        columnMin[static_cast<size_t>(x)] = y;
      if (y > columnMax[static_cast<size_t>(x)])
        columnMax[static_cast<size_t>(x)] = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  profile.hasContent = maxX >= 0;
  if (!profile.hasContent) {
    return true;
  }
  profile.minX = minX;
  profile.maxX = maxX;
  profile.minY = minY;
  profile.maxY = maxY;

  auto collect = [](std::vector<int> values, int empty,
                    std::vector<int>& out) {
    constexpr size_t kMaxEdges = 65536;
    values.erase(std::remove(values.begin(), values.end(), empty),
                 values.end());
    std::sort(values.begin(), values.end());
    values.erase(std::unique(values.begin(), values.end()), values.end());
    if (values.size() > kMaxEdges) {
      values.resize(kMaxEdges);
    }
    out = std::move(values);
  };
  collect(rowMin, width, profile.leftEdges);
  collect(rowMax, -1, profile.rightEdges);
  collect(columnMin, height, profile.topEdges);
  collect(columnMax, -1, profile.bottomEdges);
  return true;
}

}  // namespace mania
