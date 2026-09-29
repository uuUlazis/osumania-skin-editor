#include <cassert>
#include <iostream>
#include <string>
#include <vector>

#include "ini/ini_document.h"
#include "ini/mania_schema.h"

namespace {

void expect(bool condition, const std::string& message) {
  if (!condition) {
    std::cerr << "FAIL: " << message << "\n";
    std::exit(1);
  }
}

}  // namespace

int main() {
  using namespace mania;

  const std::string sample =
      "[General]\r\n"
      "Name: Test Skin\r\n"
      "Version: latest\r\n"
      "\r\n"
      "[Mania]\r\n"
      "Keys: 4\r\n"
      "// 4K config\r\n"
      "ColumnStart: 200\r\n"
      "ColumnWidth: 50,50,50,50\r\n"
      "NoteImage0: mania-note1\r\n"
      "Colour1: 0,0,0,255\r\n"
      "UnknownKey: keep me\r\n"
      "[Colours]\r\n"
      "Combo1: 255,100,250\r\n";

  auto document = IniDocument::parse(sample);
  expect(document.has_value(), "parse should succeed");
  expect(document->serialize() == sample, "round-trip should preserve text");
  expect(document->hasBom() == false, "no BOM expected");
  expect(document->generalVersion().has_value() &&
             *document->generalVersion() == "latest",
         "general version");

  auto blocks = document->maniaBlocks();
  expect(blocks.size() == 1, "one mania block");
  expect(blocks[0].keys && *blocks[0].keys == 4, "keys 4");

  std::vector<std::string> errors;
  bool applied = document->applyManiaUpdates(
      4,
      {{"ColumnStart", "300"}, {"NoteImage0", "mania-note2"},
       {"Colour1", "1,2,3,4"}},
      errors);
  expect(applied, "apply updates");
  expect(errors.empty(), "no errors");
  expect(document->serialize().find("ColumnStart: 300") != std::string::npos,
         "updated entry");
  expect(document->serialize().find("// 4K config") != std::string::npos,
         "comment preserved");
  expect(document->serialize().find("UnknownKey: keep me") != std::string::npos,
         "unknown key preserved");
  expect(document->serialize().find("NoteImage0: mania-note2") !=
             std::string::npos,
         "updated note image");

  document->setGeneralVersion("2.5");
  expect(*document->generalVersion() == "2.5", "set version");

  const FieldSpec* noteImage = findFieldForConcreteKey("NoteImage3");
  expect(noteImage != nullptr && noteImage->name == "NoteImage",
         "concrete key resolution");
  expect(findFieldForConcreteKey("NotAField") == nullptr,
         "unknown key not resolved");
  expect(concreteKeysForField(*noteImage, 7).size() == 7,
         "concrete keys count");

  const FieldSpec* colour = findFieldForConcreteKey("Colour4");
  expect(colour != nullptr && colour->indexStart == 1,
         "colour index starts at 1");

  std::string fieldError;
  expect(validateFieldValue(*colour, 4, "255,0,0,128", fieldError),
         "valid rgba");
  expect(!validateFieldValue(*colour, 4, "999,0,0", fieldError),
         "invalid rgba");

  const FieldSpec* width = findFieldForConcreteKey("ColumnWidth");
  expect(width != nullptr, "column width field");
  expect(!validateFieldValue(*width, 4, "50,50,50,50,50", fieldError),
         "too many list values rejected");
  expect(validateFieldValue(*width, 4, "50,50,50,50", fieldError),
         "list values valid");

  std::cout << "all ini tests passed\n";
  return 0;
}
