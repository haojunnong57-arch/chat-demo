import Foundation
import WebKit

/// 把 JS 的 MCP JSON-RPC 请求转成原生 URLSession 请求，绕开 MCP 服务端未配置 CORS 的问题。
enum McpBridge {
  private static let session: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 30
    configuration.timeoutIntervalForResource = 45
    configuration.waitsForConnectivity = true
    configuration.httpMaximumConnectionsPerHost = 4
    return URLSession(configuration: configuration)
  }()

  static func handle(message: WKScriptMessage, webView: WKWebView?) {
    guard let body = message.body as? [String: Any],
          let id = (body["id"] as? NSNumber)?.intValue ?? (body["id"] as? Int),
          let urlString = body["url"] as? String,
          let url = URL(string: urlString),
          let scheme = url.scheme?.lowercased(),
          scheme == "http" || scheme == "https" else {
      respond(webView: webView, payload: ["id": 0, "error": "MCP 请求参数不合法"])
      return
    }

    let method = (body["method"] as? String ?? "POST").uppercased()
    guard method == "POST" else {
      respond(webView: webView, payload: ["id": id, "error": "只支持 MCP Streamable HTTP 的 POST 请求"])
      return
    }

    var request = URLRequest(url: url)
    request.httpMethod = method
    request.timeoutInterval = 30

    if let headers = body["headers"] as? [String: Any] {
      for (key, value) in headers {
        request.setValue(String(describing: value), forHTTPHeaderField: key)
      }
    }
    if let requestBody = body["body"] as? String, !requestBody.isEmpty {
      request.httpBody = Data(requestBody.utf8)
    }

    session.dataTask(with: request) { data, response, error in
      if let error {
        respond(
          webView: webView,
          payload: ["id": id, "status": 0, "headers": [:], "body": "", "error": error.localizedDescription]
        )
        return
      }
      guard let http = response as? HTTPURLResponse else {
        respond(webView: webView, payload: ["id": id, "status": 0, "headers": [:], "body": "", "error": "MCP 服务端没有返回 HTTP 响应"])
        return
      }
      var headers: [String: String] = [:]
      for (key, value) in http.allHeaderFields {
        headers[String(describing: key).lowercased()] = String(describing: value)
      }
      let data = data ?? Data()
      let text = String(data: data, encoding: .utf8) ?? ""
      respond(
        webView: webView,
        payload: [
          "id": id,
          "status": http.statusCode,
          "headers": headers,
          "body": text,
        ]
      )
    }.resume()
  }

  private static func respond(webView: WKWebView?, payload: [String: Any]) {
    guard let webView else { return }
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
          var json = String(data: data, encoding: .utf8) else {
      return
    }
    json = json
      .replacingOccurrences(of: "\u{2028}", with: "\\u2028")
      .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
    let script = "window.__mcpHttpResponse && window.__mcpHttpResponse(\(json));"
    DispatchQueue.main.async {
      webView.evaluateJavaScript(script, completionHandler: nil)
    }
  }
}
