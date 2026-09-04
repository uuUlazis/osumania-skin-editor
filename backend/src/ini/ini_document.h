#pragma once

#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace mania {

enum class LineKind { Blank, Comment, Section, Entry };

struct IniLine {
  LineKind kind = LineKind::Blank;
  std::string raw;    // original line text without line ending
  std::string key;    // section name or entry key (original case)
  std::string value;  // entry value (trimmed)
  bool dirty = false; // entry value changed, needs normalized serialization
};

struct FieldUpdate {
  std::string key;
  std::string value;
};

struct ManiaBlockView {
  size_t headerIndex = 0;
  std::vector<size_t> entryIndices;
  std::optional<int> keys;
};

class IniDocument {
 public:
  static std::optional<IniDocument> parse(std::string_view text);

  std::string serialize() const;

  std::vector<ManiaBlockView> maniaBlocks() const;
  bool applyManiaUpdates(int keys,
                         const std::vector<FieldUpdate>& updates,
                         std::vector<std::string>& errors);

  std::optional<std::string> generalVersion() const;
  void setGeneralVersion(std::string_view version);

  bool hasBom() const { return has_bom_; }
  const std::vector<IniLine>& lines() const { return lines_; }

 private:
  std::vector<IniLine> lines_;
  bool has_bom_ = false;
  bool crlf_ = false;
  bool final_newline_ = true;
};

std::string trimAscii(std::string_view text);
bool iequalsAscii(std::string_view a, std::string_view b);
std::string toLowerAscii(std::string_view text);
bool isValidKeysValue(int keys);

}  // namespace mania
