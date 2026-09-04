#pragma once

#include <filesystem>
#include <thread>

#include <httplib.h>

#include "skins/skin_ops.h"

namespace mania {

class ApiServer {
 public:
  explicit ApiServer(int port = 0);
  ~ApiServer();

  ApiServer(const ApiServer&) = delete;
  ApiServer& operator=(const ApiServer&) = delete;

  bool start();
  void stop();

  int port() const { return port_; }
  void setDistDir(std::filesystem::path dir) { dist_dir_ = std::move(dir); }

 private:
  void registerRoutes();

  int port_ = 0;
  std::filesystem::path dist_dir_;
  httplib::Server server_;
  std::thread listener_;
  SkinOpsManager opsManager_;
};

}  // namespace mania
