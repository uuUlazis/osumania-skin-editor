#include "ini/ini_document.h"

#include <algorithm>
#include <cctype>
#include <cstdlib>

namespace mania {

std::string trimAscii(std::string_view text) {
  size_t begin = 0;
  while (begin < text.size() &&
         (text[begin] == ' ' || text[begin] == '\t')) {
    ++begin;
  }
  size_t end = text.size();
  while (end > begin && (text[end - 1] == ' ' || text[end - 1] == '\t')) {
    --end;
  }
  return std::string(text.substr(begin, end - begin));
}

std::string toLowerAscii(std::string_view text) {
  std::string out(text);
  std::transform(out.begin(), out.end(), out.begin(),
                 [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return out;
}

bool iequalsAscii(std::string_view a, std::string_view b) {
  return toLowerAscii(a) == toLowerAscii(b);
}

bool isValidKeysValue(int keys) {
  return (keys >= 1 && keys <= 10) || keys == 12 || keys == 14 ||
         keys == 16 || keys == 18;
}

namespace {

IniLine makeLine(std::string_view line) {
  IniLine out;
  out.raw = std::string(line);
  if (line.empty()) {
    out.kind = LineKind::Blank;
    return out;
  }

  std::string trimmed = trimAscii(line);
  if (trimmed.empty()) {
    out.kind = LineKind::Blank;
    return out;
  }
  if (trimmed.rfind("//", 0) == 0) {
    out.kind = LineKind::Comment;
    return out;
  }
  if (trimmed.front() == '[') {
    auto close = trimmed.find(']');
    if (close != std::string::npos) {
      out.kind = LineKind::Section;
      out.key = trimAscii(std::string_view(trimmed).substr(1, close - 1));
      return out;
    }
  }

  out.kind = LineKind::Entry;
  auto colon = line.find(':');
  if (colon != std::string_view::npos) {
    out.key = trimAscii(line.substr(0, colon));
    out.value = trimAscii(line.substr(colon + 1));
  } else {
    out.key = trimAscii(line);
  }
  return out;
}

}  // namespace

std::optional<IniDocument> IniDocument::parse(std::string_view text) {
  IniDocument doc;
  std::string_view content = text;
  if (content.size() >= 3 &&
      static_cast<unsigned char>(content[0]) == 0xEF &&
      static_cast<unsigned char>(content[1]) == 0xBB &&
      static_cast<unsigned char>(content[2]) == 0xBF) {
    doc.has_bom_ = true;
    content.remove_prefix(3);
  }
  doc.crlf_ = content.find("\r\n") != std::string_view::npos;
  doc.final_newline_ = !content.empty() && content.back() == '\n';

  size_t start = 0;
  while (start < content.size()) {
    auto nl = content.find('\n', start);
    std::string_view line;
    if (nl == std::string_view::npos) {
      line = content.substr(start);
      if (!line.empty() && line.back() == '\r') {
        line.remove_suffix(1);
      }
      doc.lines_.push_back(makeLine(line));
      break;
    }
    line = content.substr(start, nl - start);
    if (!line.empty() && line.back() == '\r') {
      line.remove_suffix(1);
    }
    doc.lines_.push_back(makeLine(line));
    start = nl + 1;
  }
  return doc;
}

std::string IniDocument::serialize() const {
  std::string out;
  if (has_bom_) {
    out.append("\xEF\xBB\xBF", 3);
  }
  const std::string eol = crlf_ ? "\r\n" : "\n";
  for (size_t i = 0; i < lines_.size(); ++i) {
    const IniLine& line = lines_[i];
    if (line.kind == LineKind::Entry && line.dirty) {
      out += line.key;
      out += ": ";
      out += line.value;
    } else {
      out += line.raw;
    }
    bool isLast = i + 1 == lines_.size();
    if (!isLast || final_newline_) {
      out += eol;
    }
  }
  return out;
}

std::vector<ManiaBlockView> IniDocument::maniaBlocks() const {
  std::vector<ManiaBlockView> blocks;
  ManiaBlockView* current = nullptr;
  for (size_t i = 0; i < lines_.size(); ++i) {
    const IniLine& line = lines_[i];
    if (line.kind == LineKind::Section) {
      if (iequalsAscii(line.key, "mania")) {
        blocks.push_back(ManiaBlockView{});
        current = &blocks.back();
        current->headerIndex = i;
      } else {
        current = nullptr;
      }
      continue;
    }
    if (current && line.kind == LineKind::Entry) {
      current->entryIndices.push_back(i);
      if (iequalsAscii(line.key, "Keys") && !current->keys.has_value()) {
        int value = std::atoi(line.value.c_str());
        if (isValidKeysValue(value)) {
          current->keys = value;
        }
      }
    }
  }
  return blocks;
}

bool IniDocument::applyManiaUpdates(
    int keys, const std::vector<FieldUpdate>& updates,
    std::vector<std::string>& errors) {
  auto blocks = maniaBlocks();
  const ManiaBlockView* block = nullptr;
  for (const auto& b : blocks) {
    if (b.keys && *b.keys == keys) {
      block = &b;
      break;
    }
  }
  if (!block) {
    errors.push_back("未找到 Keys 为 " + std::to_string(keys) +
                     " 的 [Mania] 小节");
    return false;
  }

  for (const auto& update : updates) {
    size_t found = std::string::npos;
    for (size_t idx : block->entryIndices) {
      if (iequalsAscii(lines_[idx].key, update.key)) {
        found = idx;
        break;
      }
    }
    if (found != std::string::npos) {
      IniLine& line = lines_[found];
      if (line.value != update.value) {
        line.value = update.value;
        line.dirty = true;
      }
      continue;
    }

    IniLine inserted;
    inserted.kind = LineKind::Entry;
    inserted.raw = update.key + ": " + update.value;
    inserted.key = update.key;
    inserted.value = update.value;
    inserted.dirty = true;
    lines_.insert(lines_.begin() + static_cast<ptrdiff_t>(block->headerIndex + 1),
                  std::move(inserted));
  }
  return true;
}

std::optional<std::string> IniDocument::generalVersion() const {
  bool inGeneral = false;
  for (const auto& line : lines_) {
    if (line.kind == LineKind::Section) {
      inGeneral = iequalsAscii(line.key, "General");
      continue;
    }
    if (inGeneral && line.kind == LineKind::Entry &&
        iequalsAscii(line.key, "Version")) {
      return line.value;
    }
  }
  return std::nullopt;
}

void IniDocument::setGeneralVersion(std::string_view version) {
  std::optional<size_t> header;
  for (size_t i = 0; i < lines_.size(); ++i) {
    const IniLine& line = lines_[i];
    if (line.kind == LineKind::Section) {
      header = iequalsAscii(line.key, "General")
                   ? std::optional<size_t>(i)
                   : std::nullopt;
      continue;
    }
    if (header && line.kind == LineKind::Entry &&
        iequalsAscii(line.key, "Version")) {
      IniLine& target = const_cast<IniLine&>(lines_[i]);
      target.value = std::string(version);
      target.dirty = true;
      return;
    }
  }

  IniLine section;
  section.kind = LineKind::Section;
  section.raw = "[General]";
  section.key = "General";
  IniLine entry;
  entry.kind = LineKind::Entry;
  entry.raw = std::string("Version: ") + std::string(version);
  entry.key = "Version";
  entry.value = std::string(version);
  entry.dirty = true;

  if (header) {
    lines_.insert(lines_.begin() + static_cast<ptrdiff_t>(*header + 1),
                  std::move(entry));
  } else {
    lines_.push_back(std::move(section));
    lines_.push_back(std::move(entry));
  }
}

}  // namespace mania
