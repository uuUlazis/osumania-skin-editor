#include <windows.h>
#include <shellapi.h>

#include <chrono>
#include <filesystem>
#include <fstream>
#include <string>
#include <thread>

#include "app/launcher.h"
#include "http/api_server.h"
#include "webview/webview2_shell.h"

namespace {

std::filesystem::path executableDir() {
  wchar_t buffer[MAX_PATH]{};
  DWORD size = GetModuleFileNameW(nullptr, buffer, MAX_PATH);
  if (size == 0) {
    return std::filesystem::current_path();
  }
  return std::filesystem::path(std::wstring(buffer, size)).parent_path();
}

}  // namespace

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
  int argc = 0;
  LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  int port = 0;
  bool noWindow = false;
  std::filesystem::path portFile;
  if (argv) {
    for (int i = 1; i < argc; ++i) {
      std::wstring arg(argv[i]);
      if (arg == L"--no-window") {
        noWindow = true;
      } else if (arg == L"--port" && i + 1 < argc) {
        port = _wtoi(argv[++i]);
      } else if (arg == L"--port-file" && i + 1 < argc) {
        portFile = std::filesystem::path(argv[++i]);
      }
    }
  }

  mania::ApiServer server(port);
  server.setDistDir(executableDir() / L"frontend" / L"dist");
  if (!server.start()) {
    MessageBoxW(nullptr, L"无法启动本机服务，请检查端口是否被占用。",
                L"osu!mania 皮肤编辑器", MB_ICONERROR);
    if (argv) {
      LocalFree(argv);
    }
    return 1;
  }

  if (!portFile.empty()) {
    std::ofstream out(portFile, std::ios::trunc);
    if (out) {
      out << server.port();
    }
  }

  if (noWindow) {
    for (;;) {
      std::this_thread::sleep_for(std::chrono::seconds(1));
    }
  }

  std::wstring url =
      L"http://127.0.0.1:" + std::to_wstring(server.port()) + L"/";
  bool opened = mania::launchWebView2(instance, url);
  if (!opened) {
    mania::openInBrowser(url);
    for (;;) {
      std::this_thread::sleep_for(std::chrono::seconds(1));
    }
  }

  server.stop();
  if (argv) {
    LocalFree(argv);
  }
  return 0;
}
