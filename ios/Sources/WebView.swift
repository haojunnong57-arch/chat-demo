import SwiftUI
import WebKit
import UIKit

struct WebView: UIViewRepresentable {
  let url: URL

  func makeCoordinator() -> Coordinator { Coordinator() }

  func makeUIView(context: Context) -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.defaultWebpagePreferences.allowsContentJavaScript = true
    configuration.defaultWebpagePreferences.preferredContentMode = .mobile
    configuration.allowsInlineMediaPlayback = true
    configuration.mediaTypesRequiringUserActionForPlayback = []
    configuration.websiteDataStore = .default()
    configuration.applicationNameForUserAgent = "DeepSeekMobile/1.0"
    configuration.userContentController.add(context.coordinator, name: "mcpHttp")

    let webView = WKWebView(frame: .zero, configuration: configuration)
    webView.navigationDelegate = context.coordinator
    webView.uiDelegate = context.coordinator
    webView.allowsBackForwardNavigationGestures = false
    webView.scrollView.contentInsetAdjustmentBehavior = .never
    webView.scrollView.keyboardDismissMode = .interactive
    webView.isOpaque = true
    webView.backgroundColor = .systemBackground
    webView.load(URLRequest(url: url))
    return webView
  }

  func updateUIView(_ webView: WKWebView, context: Context) {
    guard webView.url != url else { return }
    webView.load(URLRequest(url: url))
  }

  static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
    webView.configuration.userContentController.removeScriptMessageHandler(forName: "mcpHttp")
  }

  final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    func userContentController(
      _ userContentController: WKUserContentController,
      didReceive message: WKScriptMessage
    ) {
      guard message.name == "mcpHttp" else { return }
      McpBridge.handle(message: message, webView: message.webView)
    }

    func webView(
      _ webView: WKWebView,
      decidePolicyFor navigationAction: WKNavigationAction,
      decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
      guard let target = navigationAction.request.url else {
        decisionHandler(.allow)
        return
      }
      // 应用内只允许本地页面；对话里的外链交给系统浏览器，避免把 App 导航走。
      if navigationAction.navigationType == .linkActivated,
         target.scheme == "http" || target.scheme == "https" {
        let isLocal = target.host == "127.0.0.1" || target.host == "localhost"
        if !isLocal {
          UIApplication.shared.open(target)
          decisionHandler(.cancel)
          return
        }
      }
      decisionHandler(.allow)
    }

    func webView(
      _ webView: WKWebView,
      createWebViewWith configuration: WKWebViewConfiguration,
      for navigationAction: WKNavigationAction,
      windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
      if let url = navigationAction.request.url {
        UIApplication.shared.open(url)
      }
      return nil
    }

    @available(iOS 15.0, *)
    func webView(
      _ webView: WKWebView,
      requestMediaCapturePermissionFor origin: WKSecurityOrigin,
      initiatedByFrame frame: WKFrameInfo,
      type: WKMediaCaptureType,
      decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
      // 语音输入需要麦克风；页面由本机打包资源提供，直接授予。
      switch type {
      case .microphone, .cameraAndMicrophone:
        decisionHandler(.grant)
      case .camera:
        decisionHandler(.grant)
      @unknown default:
        decisionHandler(.prompt)
      }
    }
  }
}
