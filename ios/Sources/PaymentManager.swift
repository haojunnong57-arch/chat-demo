import Foundation
import Swifter

/// 测试支付：订单、收银台、支付回调和状态查询都由 App 内置的本地服务提供。
/// 真实上线时，把 `/pay` 换成支付平台收银台，把 `/api/pay/webhook` 换成
/// 支付平台的服务器回调（必须验签），客户端轮询逻辑不用改。
final class PaymentManager {
  struct Order: Codable {
    let id: String
    let product: String
    let amountCents: Int
    let createdAt: Date
    var status: String
    var paidAt: Date?
  }

  private var orders: [String: Order] = [:]
  private let lock = NSLock()
  private let storeKey = "deepseek.payment.orders.v1"
  private let webhookToken = "test-webhook-secret"

  init() {
    load()
  }

  func handle(_ request: HttpRequest) -> HttpResponse? {
    let path = request.path

    if request.method == "POST" && path == "/api/pay/create" {
      return createOrder(request)
    }
    if request.method == "GET" && path.hasPrefix("/api/pay/order/") {
      return orderStatus(path: path)
    }
    if request.method == "POST" && path == "/api/pay/webhook" {
      return webhook(request)
    }
    if request.method == "GET" && path == "/pay" {
      return checkoutPage(request)
    }
    return nil
  }

  private func createOrder(_ request: HttpRequest) -> HttpResponse {
    let body = jsonBody(request)
    let product = (body?["product"] as? String) ?? "pro"
    let id = UUID().uuidString.lowercased()
    let order = Order(
      id: id,
      product: product,
      amountCents: 1,
      createdAt: Date(),
      status: "pending",
      paidAt: nil
    )
    lock.lock()
    orders[id] = order
    persistLocked()
    lock.unlock()

    return jsonResponse([
      "orderId": id,
      "product": product,
      "amountCents": order.amountCents,
      "currency": "CNY",
      "status": order.status,
      "payUrl": "/pay?order=\(id)",
    ])
  }

  private func orderStatus(path: String) -> HttpResponse {
    let id = String(path.dropFirst("/api/pay/order/".count))
    lock.lock()
    let order = orders[id]
    lock.unlock()
    guard let order else {
      return jsonResponse(["error": "order_not_found"], statusCode: 404, reason: "Not Found")
    }
    return jsonResponse([
      "orderId": order.id,
      "status": order.status,
      "paid": order.status == "paid",
      "amountCents": order.amountCents,
    ])
  }

  private func webhook(_ request: HttpRequest) -> HttpResponse {
    guard let body = jsonBody(request),
          let orderId = body["orderId"] as? String,
          let token = body["token"] as? String,
          token == webhookToken else {
      return jsonResponse(["error": "invalid_webhook"], statusCode: 401, reason: "Unauthorized")
    }
    lock.lock()
    guard var order = orders[orderId] else {
      lock.unlock()
      return jsonResponse(["error": "order_not_found"], statusCode: 404, reason: "Not Found")
    }
    if order.status != "paid" {
      order.status = "paid"
      order.paidAt = Date()
      orders[orderId] = order
      persistLocked()
    }
    lock.unlock()
    return jsonResponse(["ok": true, "orderId": orderId, "status": "paid"])
  }

  private func checkoutPage(_ request: HttpRequest) -> HttpResponse {
    let orderId = request.queryParams.first(where: { $0.0 == "order" })?.1 ?? ""
    lock.lock()
    let order = orders[orderId]
    lock.unlock()
    guard let order else {
      return .ok(.html("<html><body><p>订单不存在或已过期。</p></body></html>"))
    }

    let amount = String(format: "%.2f", Double(order.amountCents) / 100.0)
    let html = """
    <!doctype html>
    <html lang="zh-CN">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>DeepSeek Pro 测试收银台</title>
      <style>
        :root { color-scheme: light; }
        * { box-sizing: border-box; }
        body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
          background: #f5f7fb; color: #14171f; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; }
        .card { width: min(92vw, 420px); background: #fff; border-radius: 24px; padding: 28px 24px 22px;
          box-shadow: 0 24px 70px rgba(20, 35, 80, .12); }
        .badge { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px;
          background: #eef3ff; color: #4d6bfe; font-size: 12px; font-weight: 600; }
        h1 { margin: 18px 0 6px; font-size: 22px; letter-spacing: -.02em; }
        p { margin: 8px 0; color: #667085; font-size: 14px; line-height: 1.6; }
        .price { margin: 20px 0 22px; font-size: 34px; font-weight: 700; letter-spacing: -.03em; }
        .price small { font-size: 14px; color: #667085; font-weight: 400; margin-left: 6px; }
        button { width: 100%; border: 0; border-radius: 14px; padding: 15px 16px; background: #4d6bfe;
          color: #fff; font-size: 16px; font-weight: 600; cursor: pointer; }
        button:disabled { opacity: .55; cursor: default; }
        .cancel { display: block; margin-top: 14px; text-align: center; color: #667085;
          font-size: 14px; text-decoration: none; }
        .note { margin-top: 18px; padding: 12px; border-radius: 12px; background: #f8fafc;
          color: #98a2b3; font-size: 12px; line-height: 1.5; }
        .success { text-align: center; padding: 8px 0 2px; }
        .success .mark { width: 54px; height: 54px; margin: 0 auto 14px; border-radius: 50%;
          background: #eaf7ee; color: #16a34a; font-size: 28px; line-height: 54px; }
        .success h1 { margin-top: 0; }
      </style>
    </head>
    <body>
      <main class="card" id="card">
        <span class="badge">测试支付 · 不会真实扣款</span>
        <h1>DeepSeek Pro</h1>
        <p>解锁 Pro 功能，用于验证完整支付链路。</p>
        <div class="price">¥\(amount)<small>CNY</small></div>
        <button id="payButton">模拟支付成功</button>
        <a class="cancel" href="/">取消并返回</a>
        <div class="note">这是测试收银台。点击按钮会调用本地 webhook，把订单 \(orderId.prefix(8))… 标记为已支付；前端会自动轮询并开通 Pro。</div>
      </main>
      <script>
        const orderId = "\(orderId)";
        const token = "\(webhookToken)";
        const button = document.getElementById('payButton');
        let attempts = 0;

        async function poll() {
          attempts += 1;
          try {
            const response = await fetch('/api/pay/order/' + encodeURIComponent(orderId));
            const data = await response.json();
            if (data.status === 'paid') {
              localStorage.setItem('chat-demo:pro', 'true');
              showSuccess();
              return;
            }
          } catch (error) {}
          if (attempts < 30) {
            setTimeout(poll, 800);
          } else {
            button.disabled = false;
            button.textContent = '重新检查支付结果';
          }
        }

        function showSuccess() {
          document.getElementById('card').innerHTML =
            '<div class="success"><div class="mark">✓</div><h1>支付成功</h1>' +
            '<p>Pro 已开通，正在返回 App…</p></div>';
          setTimeout(() => location.replace('/'), 900);
        }

        button.addEventListener('click', async () => {
          button.disabled = true;
          button.textContent = '支付处理中…';
          try {
            const response = await fetch('/api/pay/webhook', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ orderId, token })
            });
            if (!response.ok) throw new Error('webhook failed');
            attempts = 0;
            poll();
          } catch (error) {
            button.disabled = false;
            button.textContent = '模拟支付成功';
            alert('测试支付失败，请重试');
          }
        });
      </script>
    </body>
    </html>
    """
    return .ok(.html(html))
  }

  private func jsonBody(_ request: HttpRequest) -> [String: Any]? {
    guard !request.body.isEmpty,
          let object = try? JSONSerialization.jsonObject(with: Data(request.body)) else {
      return nil
    }
    return object as? [String: Any]
  }

  private func jsonResponse(
    _ object: [String: Any],
    statusCode: Int = 200,
    reason: String = "OK"
  ) -> HttpResponse {
    let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
    return .raw(statusCode, reason, [
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": String(data.count),
      "Cache-Control": "no-store",
    ]) { writer in
      try writer.write(data)
    }
  }

  private func load() {
    guard let data = UserDefaults.standard.data(forKey: storeKey),
          let decoded = try? JSONDecoder().decode([String: Order].self, from: data) else {
      return
    }
    orders = decoded
  }

  private func persistLocked() {
    guard let data = try? JSONEncoder().encode(orders) else { return }
    UserDefaults.standard.set(data, forKey: storeKey)
  }
}
