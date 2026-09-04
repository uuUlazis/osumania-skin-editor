#include "webview/webview2_shell.h"

#include <windows.h>
#include <shlobj.h>
#include <wrl/client.h>
#include <wrl/event.h>

#include <string>

#include "app/launcher.h"

#ifdef MANIA_HAS_WEBVIEW2

#include <WebView2.h>

namespace mania {
namespace {

constexpr wchar_t kWindowClass[] = L"ManiaSkinEditorWindow";
constexpr wchar_t kWindowTitle[] = L"osu!mania 皮肤 skin.ini 编辑器";

std::wstring webViewUserDataFolder() {
  wchar_t buffer[MAX_PATH]{};
  if (SHGetFolderPathW(nullptr, CSIDL_LOCAL_APPDATA, nullptr,
                       SHGFP_TYPE_CURRENT, buffer) != S_OK) {
    return {};
  }
  return std::wstring(buffer) + L"\\ManiaSkinEditor\\WebView2";
}

class AppWindow {
 public:
  explicit AppWindow(std::wstring url) : url_(std::move(url)) {}

  bool create(HINSTANCE instance) {
    instance_ = instance;
    WNDCLASSEXW windowClass{};
    windowClass.cbSize = sizeof(windowClass);
    windowClass.lpfnWndProc = &AppWindow::wndProc;
    windowClass.hInstance = instance;
    windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    windowClass.hbrBackground =
        static_cast<HBRUSH>(GetStockObject(DKGRAY_BRUSH));
    windowClass.lpszClassName = kWindowClass;
    if (!RegisterClassExW(&windowClass) &&
        GetLastError() != ERROR_CLASS_ALREADY_EXISTS) {
      return false;
    }

    RECT bounds{0, 0, 1280, 820};
    AdjustWindowRectEx(&bounds, WS_OVERLAPPEDWINDOW, FALSE, 0);
    hwnd_ = CreateWindowExW(
        0, kWindowClass, kWindowTitle, WS_OVERLAPPEDWINDOW | WS_VISIBLE,
        CW_USEDEFAULT, CW_USEDEFAULT, bounds.right - bounds.left,
        bounds.bottom - bounds.top, nullptr, nullptr, instance, this);
    return hwnd_ != nullptr;
  }

  void initializeWebView() {
    auto environmentHandler =
        Microsoft::WRL::Callback<
            ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [this](HRESULT result,
                   ICoreWebView2Environment* environment) -> HRESULT {
              if (FAILED(result) || !environment) {
                handleWebViewFailure();
                return result;
              }
              auto controllerHandler =
                  Microsoft::WRL::Callback<
                      ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                      [this](HRESULT controllerResult,
                             ICoreWebView2Controller* controller) -> HRESULT {
                        if (FAILED(controllerResult) || !controller) {
                          handleWebViewFailure();
                          return controllerResult;
                        }
                        controller_ = controller;
                        if (SUCCEEDED(
                                controller_->get_CoreWebView2(&webview_)) &&
                            webview_) {
                          webview_->Navigate(url_.c_str());
                        }
                        RECT client{};
                        GetClientRect(hwnd_, &client);
                        controller_->put_Bounds(client);
                        return S_OK;
                      });
              return environment->CreateCoreWebView2Controller(
                  hwnd_, controllerHandler.Get());
            });

    HRESULT startResult = CreateCoreWebView2EnvironmentWithOptions(
        nullptr, webViewUserDataFolder().c_str(), nullptr,
        environmentHandler.Get());
    if (FAILED(startResult)) {
      handleWebViewFailure();
    }
  }

  int run() {
    MSG message{};
    while (GetMessageW(&message, nullptr, 0, 0)) {
      TranslateMessage(&message);
      DispatchMessageW(&message);
    }
    return static_cast<int>(message.wParam);
  }

 private:
  static LRESULT CALLBACK wndProc(HWND hwnd, UINT message, WPARAM wParam,
                                  LPARAM lParam) {
    AppWindow* self = reinterpret_cast<AppWindow*>(
        GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (message == WM_NCCREATE) {
      auto create = reinterpret_cast<CREATESTRUCTW*>(lParam);
      self = static_cast<AppWindow*>(create->lpCreateParams);
      self->hwnd_ = hwnd;
      SetWindowLongPtrW(hwnd, GWLP_USERDATA,
                        reinterpret_cast<LONG_PTR>(self));
      return TRUE;
    }
    switch (message) {
      case WM_SIZE:
        if (self && self->controller_) {
          RECT client{};
          GetClientRect(hwnd, &client);
          self->controller_->put_Bounds(client);
        }
        return 0;
      case WM_CLOSE:
        DestroyWindow(hwnd);
        return 0;
      case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
      default:
        break;
    }
    return DefWindowProcW(hwnd, message, wParam, lParam);
  }

  void handleWebViewFailure() {
    openInBrowser(url_);
    if (hwnd_) {
      PostMessageW(hwnd_, WM_CLOSE, 0, 0);
    }
  }

  HINSTANCE instance_ = nullptr;
  HWND hwnd_ = nullptr;
  std::wstring url_;
  Microsoft::WRL::ComPtr<ICoreWebView2Controller> controller_;
  Microsoft::WRL::ComPtr<ICoreWebView2> webview_;
};

}  // namespace

bool launchWebView2(void* instance, const std::wstring& url) {
  AppWindow window(url);
  if (!window.create(static_cast<HINSTANCE>(instance))) {
    return false;
  }
  window.initializeWebView();
  window.run();
  return true;
}

}  // namespace mania

#else

namespace mania {

bool launchWebView2(void*, const std::wstring&) {
  return false;
}

}  // namespace mania

#endif
