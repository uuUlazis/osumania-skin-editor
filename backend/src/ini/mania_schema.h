#pragma once

#include <string>
#include <string_view>
#include <vector>

namespace mania {

enum class FieldType {
  Number,
  Integer,
  Bool,
  Enum,
  Rgb,
  Rgba,
  Text,
  ListNumber,
  ListInteger,
};

struct FieldSpec {
  std::string name;          // base key name, e.g. "NoteImage"
  std::string label;         // Chinese label
  std::string group;         // layout / stage / flip / hold / color / image
  FieldType type = FieldType::Text;
  std::string defaultValue;
  bool perColumn = false;
  int indexStart = 0;        // 0-based column index or 1-based colour index
  std::string indexSuffix;   // suffix after the column index, e.g. "D"/"H"/"L"/"T"
  std::vector<std::string> enumValues;
  std::string help;
  bool requiresVersion25 = false;
};

const std::vector<FieldSpec>& maniaFields();
const FieldSpec* findFieldForConcreteKey(std::string_view concreteKey);
std::vector<std::string> concreteKeysForField(const FieldSpec& spec, int keys);

// Returns false and fills `error` when the value is invalid. Empty strings are
// treated as "use default" and pass validation for optional fields.
bool validateFieldValue(const FieldSpec& spec, int keys,
                        const std::string& value, std::string& error);

std::string fieldTypeName(FieldType type);

}  // namespace mania
