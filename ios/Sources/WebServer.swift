import Foundation
import Swifter

/// 在 127.0.0.1 起一个只读静态服务器，把打包进 App 的官方前端页面提供给 WKWebView。
/// 用 localhost 而不是 file://，语音输入所需的 getUserMedia 才有安全上下文。
final class WebServer: ObservableObject {
  @Published private(set) var rootURL: URL?
  @Published private(set) var error: String?

  private let server = HttpServer()
  private var started = false
  private var webDirectory: URL?

  func start() {
    guard !started else { return }
    started = true

    guard let resourceURL = Bundle.main.resourceURL else {
      error = "找不到 App 资源目录"
      return
    }
    let webDir = resourceURL.appendingPathComponent("web", isDirectory: true)
    guard FileManager.default.fileExists(atPath: webDir.appendingPathComponent("index.html").path) else {
      error = "找不到内置页面 web/index.html"
      return
    }
    webDirectory = webDir

    server["/"] = { [weak self] request in
      self?.serve(request: request, relativePath: "index.html") ?? .notFound()
    }
    server["/:path"] = { [weak self] request in
      let path = request.params[":path"] ?? request.params["path"] ?? ""
      return self?.serve(request: request, relativePath: path) ?? .notFound()
    }

    do {
      try server.start(0, forceIPv4: true)
      let port = try server.port()
      guard let url = URL(string: "http://127.0.0.1:\(port)/") else {
        error = "无法生成本地页面地址"
        return
      }
      rootURL = url
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func serve(request: HttpRequest, relativePath: String) -> HttpResponse {
    guard let webDirectory else { return .notFound() }
    let root = webDirectory.standardizedFileURL
    var relative = relativePath
    if relative.isEmpty {
      relative = "index.html"
    }
    if relative.hasPrefix("/") {
      relative.removeFirst()
    }
    let fileURL = root.appendingPathComponent(relative).standardizedFileURL
    let rootPrefix = root.path.hasSuffix("/") ? root.path : root.path + "/"
    guard fileURL.path.hasPrefix(rootPrefix) else {
      return .notFound()
    }
    guard FileManager.default.fileExists(atPath: fileURL.path),
          let data = try? Data(contentsOf: fileURL) else {
      return .notFound()
    }

    var headers: [String: String] = [
      "Content-Type": Self.mimeType(for: fileURL.pathExtension.lowercased()),
      "Content-Length": String(data.count),
      "Cache-Control": fileURL.lastPathComponent == "index.html" ? "no-store" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    ]
    if fileURL.pathExtension.lowercased() == "html" {
      headers["Cache-Control"] = "no-store"
    }
    return .raw(200, "OK", headers) { writer in
      try writer.write(data)
    }
  }

  private static func mimeType(for ext: String) -> String {
    switch ext {
    case "html", "htm": return "text/html; charset=utf-8"
    case "css": return "text/css; charset=utf-8"
    case "js", "mjs": return "application/javascript; charset=utf-8"
    case "json": return "application/json; charset=utf-8"
    case "svg": return "image/svg+xml"
    case "png": return "image/png"
    case "jpg", "jpeg": return "image/jpeg"
    case "gif": return "image/gif"
    case "webp": return "image/webp"
    case "ico": return "image/x-icon"
    case "woff": return "font/woff"
    case "woff2": return "font/woff2"
    case "ttf": return "font/ttf"
    case "otf": return "font/otf"
    case "map": return "application/json"
    case "txt": return "text/plain; charset=utf-8"
    case "pdf": return "application/pdf"
    default: return "application/octet-stream"
    }
  }
}
