import SwiftUI
import AVFoundation

@main
struct DeepSeekApp: App {
  @StateObject private var webServer = WebServer()

  init() {
    let session = AVAudioSession.sharedInstance()
    try? session.setCategory(
      .playAndRecord,
      mode: .default,
      options: [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP]
    )
  }

  var body: some Scene {
    WindowGroup {
      RootView(webServer: webServer)
        .preferredColorScheme(nil)
    }
  }
}

private struct RootView: View {
  @ObservedObject var webServer: WebServer
  @State private var started = false

  var body: some View {
    ZStack {
      Color(uiColor: .systemBackground).ignoresSafeArea()
      if let url = webServer.rootURL {
        WebView(url: url)
          .ignoresSafeArea()
      } else if let error = webServer.error {
        VStack(spacing: 12) {
          Image(systemName: "exclamationmark.triangle")
            .font(.system(size: 28))
          Text("本地页面启动失败")
            .font(.headline)
          Text(error)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 24)
        }
      } else {
        ProgressView()
      }
    }
    .task {
      guard !started else { return }
      started = true
      webServer.start()
    }
  }
}
