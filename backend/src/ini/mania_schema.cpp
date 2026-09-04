#include "ini/mania_schema.h"

#include <algorithm>
#include <cctype>
#include <charconv>
#include <cmath>
#include <cstdlib>

#include "ini/ini_document.h"

namespace mania {

namespace {

FieldSpec spec(std::string name, std::string label, std::string group,
               FieldType type, std::string defaultValue, std::string help,
               bool perColumn = false, int indexStart = 0,
               std::vector<std::string> enumValues = {},
               std::string indexSuffix = "",
               bool requiresVersion25 = false) {
  FieldSpec s;
  s.name = std::move(name);
  s.label = std::move(label);
  s.group = std::move(group);
  s.type = type;
  s.defaultValue = std::move(defaultValue);
  s.help = std::move(help);
  s.perColumn = perColumn;
  s.indexStart = indexStart;
  s.indexSuffix = std::move(indexSuffix);
  s.enumValues = std::move(enumValues);
  s.requiresVersion25 = requiresVersion25;
  return s;
}

bool parseDouble(std::string_view text, double& out) {
  if (text.empty()) {
    return false;
  }
  std::string copy(text);
  const char* begin = copy.c_str();
  char* end = nullptr;
  out = std::strtod(begin, &end);
  return end != begin && *end == '\0';
}

bool parseInteger(std::string_view text, int& out) {
  if (text.empty()) {
    return false;
  }
  std::string copy(text);
  auto result = std::from_chars(copy.data(), copy.data() + copy.size(), out);
  return result.ec == std::errc() && result.ptr == copy.data() + copy.size();
}

bool splitList(std::string_view text, std::vector<std::string>& out) {
  size_t start = 0;
  while (start <= text.size()) {
    auto comma = text.find(',', start);
    if (comma == std::string_view::npos) {
      out.push_back(trimAscii(text.substr(start)));
      break;
    }
    out.push_back(trimAscii(text.substr(start, comma - start)));
    start = comma + 1;
  }
  return true;
}

bool validateColor(std::string_view value, bool allowAlpha,
                   std::string& error) {
  std::vector<std::string> parts;
  splitList(value, parts);
  const size_t expected = allowAlpha ? 4 : 3;
  if (parts.size() != 3 && !(allowAlpha && parts.size() == 4)) {
    error = "应为 " + std::to_string(expected) +
            " 个 0-255 的整数（RGB 或 RGBA）";
    return false;
  }
  for (const auto& part : parts) {
    int channel = 0;
    if (!parseInteger(part, channel) || channel < 0 || channel > 255) {
      error = "颜色通道必须是 0-255 的整数";
      return false;
    }
  }
  return true;
}

}  // namespace

const std::vector<FieldSpec>& maniaFields() {
  static const std::vector<FieldSpec> kFields = [] {
    std::vector<FieldSpec> v;
    // Layout & judgement
    v.push_back(spec("Keys", "键数", "layout", FieldType::Integer, "",
                     "每个 [Mania] 小节的必填参数，编辑器中不可修改"));
    v.push_back(spec("ColumnStart", "最左列起始", "common", FieldType::Number,
                     "136", "最左列从哪里开始放置（以 480 像素高度为基准）"));
    v.push_back(spec("ColumnRight", "列最右位置", "layout", FieldType::Number,
                     "19", "列最多可以绘制到哪里"));
    v.push_back(spec("ColumnSpacing", "列间距", "layout", FieldType::ListNumber,
                     "0", "列与列之间的间距，按列数填写"));
    v.push_back(spec("ColumnWidth", "列宽", "common", FieldType::ListNumber,
                     "30", "每列宽度；键数大或按键较宽时建议更小"));
    v.push_back(spec("ColumnLineWidth", "列分隔线宽", "layout",
                     FieldType::ListNumber, "2", "列与列间分隔线的宽度"));
    v.push_back(spec("BarlineHeight", "小节线宽", "common", FieldType::Number,
                     "1.2", "小节线（整拍线）的宽度"));
    v.push_back(spec("LightingNWidth", "音符闪光宽", "layout",
                     FieldType::ListNumber, "", "每列 LightingN 的宽度"));
    v.push_back(spec("LightingLWidth", "长按闪光宽", "layout",
                     FieldType::ListNumber, "", "每列 LightingL 的宽度"));
    v.push_back(spec("WidthForNoteHeightScale", "音符高度基准", "layout",
                     FieldType::Number, "",
                     "列宽不同时的音符高度；不填则按最小列宽成正比"));
    v.push_back(spec("HitPosition", "判定线高度", "common", FieldType::Integer,
                     "402", "判定线绘制的高度"));
    v.push_back(spec("LightPosition", "闪光绘制高度", "layout",
                     FieldType::Integer, "413",
                     "游玩区域闪光绘制高度（仅用于 StageLight）"));
    v.push_back(spec("ScorePosition", "判定结果高度", "common",
                     FieldType::Integer, "", "打击结果出现的高度"));
    v.push_back(spec("ComboPosition", "连击计数高度", "common",
                     FieldType::Integer, "", "连击计数器出现的高度"));
    v.push_back(spec("JudgementLine", "判定提示线", "layout", FieldType::Bool,
                     "", "StageHint 上方是否再绘制一条提示线"));
    v.push_back(spec("LightFramePerSecond", "闪光动画帧率", "layout",
                     FieldType::Integer, "", "StageLight 的动画帧率"));

    // Special style & stage
    v.push_back(spec("SpecialStyle", "特殊键", "stage", FieldType::Enum, "0",
                     "0=无；1=左(SP)/外(DP)；2=右(SP)/内(DP)；仅用于大于 4 的偶数键",
                     false, 0, {"0", "1", "2"}));
    v.push_back(spec("ComboBurstStyle", "连击提示图位置", "stage",
                     FieldType::Enum, "1",
                     "0=Left，1=Right，2=Both（随机）；也可填单词",
                     false, 0, {"0", "1", "2", "Left", "Right", "Both"}));
    v.push_back(spec("SplitStages", "分割舞台", "stage", FieldType::Bool, "",
                     "定义时必须赋值；0=不分割/强制 SP"));
    v.push_back(spec("StageSeparation", "舞台间距", "stage", FieldType::Number,
                     "40", "舞台分割时两个舞台之间的距离"));
    v.push_back(spec("SeparateScore", "判定只显示在得分舞台", "stage",
                     FieldType::Bool, "1",
                     "0=两个舞台同时显示；1=只显示在打击的舞台"));
    v.push_back(spec("KeysUnderNotes", "按键被音符覆盖", "stage",
                     FieldType::Bool, "0",
                     "音符经过按键时，按键是否被音符覆盖"));
    v.push_back(spec("UpsideDown", "上下颠倒", "stage", FieldType::Bool, "0",
                     "舞台整体上下颠倒"));

    // Upside-down flips (skin version > 2.5)
    const bool v25 = true;
    v.push_back(spec("KeyFlipWhenUpsideDown", "按键整体翻转", "flip",
                     FieldType::Bool, "1", "颠倒时所有按键是否上下翻转", false, 0,
                     {}, "", v25));
    v.push_back(spec("KeyFlipWhenUpsideDown", "指定列按键翻转", "flip",
                     FieldType::Bool, "", "颠倒时指定列按键是否翻转", true, 0, {},
                     "", v25));
    v.push_back(spec("KeyFlipWhenUpsideDown", "指定列按下按键翻转", "flip",
                     FieldType::Bool, "", "颠倒时指定列已按下按键是否翻转", true,
                     0, {}, "D", v25));
    v.push_back(spec("NoteFlipWhenUpsideDown", "音符整体翻转", "flip",
                     FieldType::Bool, "1", "颠倒时所有音符是否翻转", false, 0, {},
                     "", v25));
    v.push_back(spec("NoteFlipWhenUpsideDown", "指定列音符翻转", "flip",
                     FieldType::Bool, "", "颠倒时指定列音符是否翻转", true, 0, {},
                     "", v25));
    v.push_back(spec("NoteFlipWhenUpsideDown", "指定列长按头翻转", "flip",
                     FieldType::Bool, "", "颠倒时指定列长按音符头是否翻转", true,
                     0, {}, "H", v25));
    v.push_back(spec("NoteFlipWhenUpsideDown", "指定列长按体翻转", "flip",
                     FieldType::Bool, "", "颠倒时指定列长按音符体是否翻转", true,
                     0, {}, "L", v25));
    v.push_back(spec("NoteFlipWhenUpsideDown", "指定列长按尾翻转", "flip",
                     FieldType::Bool, "", "颠倒时指定列长按音符尾是否翻转", true,
                     0, {}, "T", v25));

    // Hold note body style
    v.push_back(spec("NoteBodyStyle", "长按体样式（全局）", "hold",
                     FieldType::Enum, "1", "所有列的长按音符体样式", false, 0,
                     {"0", "1", "2"}, "", v25));
    v.push_back(spec("NoteBodyStyle", "指定列长按体样式", "hold",
                     FieldType::Enum, "", "指定列的长按音符体样式", true, 0,
                     {"0", "1", "2"}, "", v25));

    // Colours
    v.push_back(spec("Colour", "列背景颜色", "color", FieldType::Rgba,
                     "0,0,0,255", "指定列的背景颜色，编号从 1 开始", true, 1));
    v.push_back(spec("ColourLight", "列闪光颜色", "color", FieldType::Rgba,
                     "55,255,255,255",
                     "指定列的闪光颜色（StageLight），编号从 1 开始，第四个值为 alpha",
                     true, 1));
    v.push_back(spec("ColourColumnLine", "列分隔线颜色", "color",
                     FieldType::Rgba, "255,255,255,255", "列与列之间分隔线的颜色"));
    v.push_back(spec("ColourBarline", "小节线颜色", "color", FieldType::Rgba,
                     "255,255,255,255", "小节线的颜色"));
    v.push_back(spec("ColourJudgementLine", "判定线颜色", "color",
                     FieldType::Rgb, "255,255,255", "判定线的颜色"));
    v.push_back(spec("ColourKeyWarning", "按键绑定提示颜色", "color",
                     FieldType::Rgb, "0,0,0", "游戏开始前按键绑定提示的颜色"));
    v.push_back(spec("ColourHold", "长按连击颜色", "color", FieldType::Rgba,
                     "255,191,51,255", "长按音符时连击计数器颜色"));
    v.push_back(spec("ColourBreak", "断连连击颜色", "color", FieldType::Rgb,
                     "255,0,0", "断连时连击计数器颜色"));

    // Images
    v.push_back(spec("KeyImage", "未按下按键图像", "image", FieldType::Text,
                     "", "指定列未按下按键的图像文件名", true, 0));
    v.push_back(spec("KeyImage", "已按下按键图像", "image", FieldType::Text, "",
                     "指定列已按下按键的图像文件名", true, 0, {}, "D"));
    v.push_back(spec("NoteImage", "单键Note图像", "image", FieldType::Text, "",
                     "指定列音符的图像文件名", true, 0));
    v.push_back(spec("NoteImage", "面条头图像", "image", FieldType::Text, "",
                     "指定列长按音符头的图像文件名", true, 0, {}, "H"));
    v.push_back(spec("NoteImage", "面条身图像", "image", FieldType::Text, "",
                     "指定列长按音符体的图像文件名", true, 0, {}, "L"));
    v.push_back(spec("NoteImage", "面条尾图像", "image", FieldType::Text, "",
                     "指定列长按音符尾的图像文件名", true, 0, {}, "T"));
    return v;
  }();
  return kFields;
}

const FieldSpec* findFieldForConcreteKey(std::string_view concreteKey) {
  for (const auto& field : maniaFields()) {
    if (!field.perColumn && iequalsAscii(field.name, concreteKey)) {
      return &field;
    }
    if (!field.perColumn) {
      continue;
    }
    if (concreteKey.size() <= field.name.size()) {
      continue;
    }
    if (!iequalsAscii(concreteKey.substr(0, field.name.size()), field.name)) {
      continue;
    }
    size_t pos = field.name.size();
    const size_t digitStart = pos;
    while (pos < concreteKey.size() &&
           std::isdigit(static_cast<unsigned char>(concreteKey[pos]))) {
      ++pos;
    }
    if (pos == digitStart) {
      continue;
    }
    if (concreteKey.substr(pos) == field.indexSuffix) {
      return &field;
    }
  }
  return nullptr;
}

std::vector<std::string> concreteKeysForField(const FieldSpec& spec,
                                               int keys) {
  if (!spec.perColumn) {
    return {spec.name};
  }
  std::vector<std::string> out;
  for (int i = 0; i < keys; ++i) {
    out.push_back(spec.name + std::to_string(spec.indexStart + i) +
                  spec.indexSuffix);
  }
  return out;
}

bool validateFieldValue(const FieldSpec& spec, int keys,
                        const std::string& value, std::string& error) {
  if (value.empty()) {
    return true;  // absent values fall back to osu defaults
  }
  switch (spec.type) {
    case FieldType::Number: {
      double number = 0;
      if (!parseDouble(value, number)) {
        error = "必须是数字";
        return false;
      }
      return true;
    }
    case FieldType::Integer: {
      int number = 0;
      if (!parseInteger(value, number)) {
        error = "必须是整数";
        return false;
      }
      if (iequalsAscii(spec.name, "Keys") && !isValidKeysValue(number)) {
        error = "Keys 必须是 1-10、12、14、16 或 18";
        return false;
      }
      return true;
    }
    case FieldType::Bool: {
      if (value != "0" && value != "1") {
        error = "只能是 0 或 1";
        return false;
      }
      return true;
    }
    case FieldType::Enum: {
      bool ok = false;
      for (const auto& option : spec.enumValues) {
        if (iequalsAscii(option, value)) {
          ok = true;
          break;
        }
      }
      if (!ok) {
        error = "可选值：" + spec.enumValues[0];
        for (size_t i = 1; i < spec.enumValues.size(); ++i) {
          error += "、" + spec.enumValues[i];
        }
        return false;
      }
      return true;
    }
    case FieldType::Rgb:
      return validateColor(value, false, error);
    case FieldType::Rgba:
      return validateColor(value, true, error);
    case FieldType::Text:
      return true;
    case FieldType::ListNumber:
    case FieldType::ListInteger: {
      std::vector<std::string> parts;
      splitList(value, parts);
      if (keys > 0 && parts.size() > static_cast<size_t>(keys)) {
        error = "最多 " + std::to_string(keys) + " 个值，多余值会被 osu! 忽略";
        return false;
      }
      for (const auto& part : parts) {
        if (spec.type == FieldType::ListInteger) {
          int number = 0;
          if (!parseInteger(part, number)) {
            error = "每个值都必须是整数";
            return false;
          }
        } else {
          double number = 0;
          if (!parseDouble(part, number)) {
            error = "每个值都必须是数字";
            return false;
          }
        }
      }
      return true;
    }
  }
  return true;
}

std::string fieldTypeName(FieldType type) {
  switch (type) {
    case FieldType::Number:
      return "number";
    case FieldType::Integer:
      return "int";
    case FieldType::Bool:
      return "bool";
    case FieldType::Enum:
      return "enum";
    case FieldType::Rgb:
      return "rgb";
    case FieldType::Rgba:
      return "rgba";
    case FieldType::Text:
      return "text";
    case FieldType::ListNumber:
      return "list_number";
    case FieldType::ListInteger:
      return "list_int";
  }
  return "text";
}

}  // namespace mania
