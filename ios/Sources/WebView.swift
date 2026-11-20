import SwiftUI
import WebKit
import UIKit

struct WebView: UIViewRepresentable {
  let url: URL

  private var fallbackURL: URL? {
    Bundle.main.resourceURL?.appendingPathComponent("web/index.html")
  }

  func makeCoordinator() -> Coordinator { Coordinator(fallbackURL: fallbackURL) }

  func makeUIView(context: Context) -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.defaultWebpagePreferences.allowsContentJavaScript = true
    configuration.defaultWebpagePreferences.preferredContentMode = .mobile
    configuration.allowsInlineMediaPlayback = true
    configuration.mediaTypesRequiringUserActionForPlayback = []
    configuration.websiteDataStore = .default()
    configuration.applicationNameForUserAgent = "DeepSeekMobile/1.0"
    configuration.userContentController.add(context.coordinator, name: "mcpHttp")
    configuration.userContentController.add(context.coordinator, name: "haptic")

    let webView = WKWebView(frame: .zero, configuration: configuration)
    webView.navigationDelegate = context.coordinator
    webView.uiDelegate = context.coordinator
    webView.allowsBackForwardNavigationGestures = false
    webView.scrollView.contentInsetAdjustmentBehavior = .never
    // 和官方移动端一致：页面固定为 1 倍，不允许双指缩放
    webView.scrollView.pinchGestureRecognizer?.isEnabled = false
    webView.scrollView.minimumZoomScale = 1
    webView.scrollView.maximumZoomScale = 1
    webView.scrollView.bouncesZoom = false
    webView.scrollView.keyboardDismissMode = .interactive
    webView.isOpaque = true
    webView.backgroundColor = .systemBackground
    context.coordinator.webView = webView
    webView.load(URLRequest(url: url))
    return webView
  }

  func updateUIView(_ webView: WKWebView, context: Context) {
    // 页面只在 makeUIView 里加载一次。这里不能再次 load，否则 fallback 到
    // 本地 file:// 之后又被重新拉回 HTTP 白页，且 triedFallback 已经置位。
  }

  static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
    webView.configuration.userContentController.removeScriptMessageHandler(forName: "mcpHttp")
    webView.configuration.userContentController.removeScriptMessageHandler(forName: "haptic")
  }

  final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    let fallbackURL: URL?
    weak var webView: WKWebView?
    private var triedFallback = false

    init(fallbackURL: URL?) {
      self.fallbackURL = fallbackURL
    }

    func userContentController(
      _ userContentController: WKUserContentController,
      didReceive message: WKScriptMessage
    ) {
      switch message.name {
      case "mcpHttp":
        McpBridge.handle(message: message, webView: message.webView)
      case "haptic":
        playHaptic(style: message.body as? String ?? "light")
      default:
        return
      }
    }

    /// Web 侧的发送、松手、上滑取消等动作在这里转成 UIKit 触感。
    private func playHaptic(style: String) {
      switch style {
      case "success", "warning":
        let generator = UINotificationFeedbackGenerator()
        generator.prepare()
        generator.notificationOccurred(style == "success" ? .success : .warning)
      case "medium":
        let generator = UIImpactFeedbackGenerator(style: .medium)
        generator.prepare()
        generator.impactOccurred()
      case "soft":
        let generator = UIImpactFeedbackGenerator(style: .soft)
        generator.prepare()
        generator.impactOccurred()
      default:
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.prepare()
        generator.impactOccurred()
      }
    }

    private func loadFallbackIfNeeded(_ webView: WKWebView) {
      guard !triedFallback, let fallbackURL else { return }
      triedFallback = true
      webView.loadFileURL(fallbackURL, allowingReadAccessTo: fallbackURL.deletingLastPathComponent())
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
      // 本地 HTTP 服务如果返回 404，WKWebView 仍是“加载成功”的白页；
      // 检查 React 根节点，为空就退回直接读取打包的 index.html。
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self, weak webView] in
        guard let self, let webView, !self.triedFallback else { return }
        webView.evaluateJavaScript("document.getElementById('root') ? document.getElementById('root').childElementCount : -1") { value, _ in
          let count = (value as? NSNumber)?.intValue ?? -1
          if count == 0 {
            self.loadFallbackIfNeeded(webView)
          }
        }
      }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
      loadFallbackIfNeeded(webView)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
      loadFallbackIfNeeded(webView)
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
