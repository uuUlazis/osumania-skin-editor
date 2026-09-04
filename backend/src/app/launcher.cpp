#include "app/launcher.h"

#include <windows.h>
#include <shellapi.h>
#include <shobjidl.h>
#include <objbase.h>

namespace mania {

std::optional<std::filesystem::path> pickFolder() {
  HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  bool initializedHere = SUCCEEDED(hr);
  if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) {
    return std::nullopt;
  }

  IFileOpenDialog* dialog = nullptr;
  hr = CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER,
                        IID_PPV_ARGS(&dialog));
  if (FAILED(hr)) {
    if (initializedHere) {
      CoUninitialize();
    }
    return std::nullopt;
  }

  dialog->SetOptions(FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM |
                     FOS_PATHMUSTEXIST);
  hr = dialog->Show(nullptr);
  std::optional<std::filesystem::path> result;
  if (SUCCEEDED(hr)) {
    IShellItem* item = nullptr;
    if (SUCCEEDED(dialog->GetResult(&item)) && item) {
      PWSTR path = nullptr;
      if (SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &path)) && path) {
        result = std::filesystem::path(path);
        CoTaskMemFree(path);
      }
      item->Release();
    }
  }
  dialog->Release();
  if (initializedHere) {
    CoUninitialize();
  }
  return result;
}

bool openInBrowser(const std::wstring& url) {
  HINSTANCE result = ShellExecuteW(nullptr, L"open", url.c_str(), nullptr,
                                   nullptr, SW_SHOWNORMAL);
  return reinterpret_cast<INT_PTR>(result) > 32;
}

std::optional<std::filesystem::path> pickPngFile(
    const std::filesystem::path& initialDir) {
  HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  bool initializedHere = SUCCEEDED(hr);
  if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) {
    return std::nullopt;
  }

  IFileOpenDialog* dialog = nullptr;
  hr = CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER,
                        IID_PPV_ARGS(&dialog));
  if (FAILED(hr)) {
    if (initializedHere) {
      CoUninitialize();
    }
    return std::nullopt;
  }

  dialog->SetOptions(FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST |
                     FOS_FILEMUSTEXIST);
  COMDLG_FILTERSPEC filter{L"PNG 图片 (*.png)", L"*.png"};
  dialog->SetFileTypes(1, &filter);
  dialog->SetDefaultExtension(L"png");

  IShellItem* initialItem = nullptr;
  if (SUCCEEDED(SHCreateItemFromParsingName(initialDir.c_str(), nullptr,
                                            IID_PPV_ARGS(&initialItem))) &&
      initialItem) {
    dialog->SetFolder(initialItem);
    initialItem->Release();
  }

  hr = dialog->Show(nullptr);
  std::optional<std::filesystem::path> result;
  if (SUCCEEDED(hr)) {
    IShellItem* item = nullptr;
    if (SUCCEEDED(dialog->GetResult(&item)) && item) {
      PWSTR path = nullptr;
      if (SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &path)) && path) {
        result = std::filesystem::path(path);
        CoTaskMemFree(path);
      }
      item->Release();
    }
  }
  dialog->Release();
  if (initializedHere) {
    CoUninitialize();
  }
  return result;
}

std::optional<std::filesystem::path> pickPngSavePath(
    const std::filesystem::path& initialDir,
    const std::wstring& defaultName) {
  HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  bool initializedHere = SUCCEEDED(hr);
  if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) {
    return std::nullopt;
  }

  IFileSaveDialog* dialog = nullptr;
  hr = CoCreateInstance(CLSID_FileSaveDialog, nullptr, CLSCTX_INPROC_SERVER,
                        IID_PPV_ARGS(&dialog));
  if (FAILED(hr)) {
    if (initializedHere) {
      CoUninitialize();
    }
    return std::nullopt;
  }

  dialog->SetOptions(FOS_OVERWRITEPROMPT | FOS_FORCEFILESYSTEM |
                     FOS_PATHMUSTEXIST);
  COMDLG_FILTERSPEC filter{L"PNG 图片 (*.png)", L"*.png"};
  dialog->SetFileTypes(1, &filter);
  dialog->SetFileTypeIndex(1);
  dialog->SetDefaultExtension(L"png");
  if (!defaultName.empty()) {
    dialog->SetFileName(defaultName.c_str());
  }

  IShellItem* initialItem = nullptr;
  if (SUCCEEDED(SHCreateItemFromParsingName(initialDir.c_str(), nullptr,
                                            IID_PPV_ARGS(&initialItem))) &&
      initialItem) {
    dialog->SetFolder(initialItem);
    initialItem->Release();
  }

  hr = dialog->Show(nullptr);
  std::optional<std::filesystem::path> result;
  if (SUCCEEDED(hr)) {
    IShellItem* item = nullptr;
    if (SUCCEEDED(dialog->GetResult(&item)) && item) {
      PWSTR path = nullptr;
      if (SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &path)) && path) {
        result = std::filesystem::path(path);
        CoTaskMemFree(path);
      }
      item->Release();
    }
  }
  dialog->Release();
  if (initializedHere) {
    CoUninitialize();
  }
  return result;
}

}  // namespace mania
