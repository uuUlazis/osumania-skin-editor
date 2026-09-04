#pragma once

#include <string>

namespace mania {

// Creates the WebView2 desktop window and runs its message loop until closed.
// Returns false when WebView2 support is unavailable; the caller should fall
// back to the system browser.
bool launchWebView2(void* instance, const std::wstring& url);

}  // namespace mania
