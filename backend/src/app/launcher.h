#pragma once

#include <filesystem>
#include <optional>
#include <string>

namespace mania {

// Opens the native Windows folder picker. Returns std::nullopt when the user
// cancels or the dialog cannot be created.
std::optional<std::filesystem::path> pickFolder();

// Native PNG file picker, initially showing inside the given directory.
std::optional<std::filesystem::path> pickPngFile(
    const std::filesystem::path& initialDir);

// Native PNG save dialog, initially showing inside the given directory.
std::optional<std::filesystem::path> pickPngSavePath(
    const std::filesystem::path& initialDir,
    const std::wstring& defaultName);

bool openInBrowser(const std::wstring& url);

}  // namespace mania
