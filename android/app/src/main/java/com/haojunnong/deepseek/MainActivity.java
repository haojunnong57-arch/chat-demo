package com.haojunnong.deepseek;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CountDownLatch;

public class MainActivity extends Activity {

    private static final int REQUEST_FILE_PICKER = 1001;
    private static final int REQUEST_AUDIO_PERMISSION = 1002;
    private static final int REQUEST_STORAGE_PERMISSION = 1003;

    private WebView webView;
    private FrameLayout root;
    private AssetServer server;

    private ValueCallback<Uri[]> fileCallback;
    private boolean lastDark = false;
    private String pendingBase64;
    private String pendingName;
    private String pendingMime;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        root = new FrameLayout(this);
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.setBackgroundColor(getColor(R.color.app_background));
        setContentView(root);

        setupEdgeToEdge();

        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.setBackgroundColor(getColor(R.color.app_background));
        root.addView(webView);

        configureWebView();

        if (Build.VERSION.SDK_INT >= 23
                && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQUEST_AUDIO_PERMISSION);
        }

        server = new AssetServer(getApplicationContext());
        server.start();
        try {
            server.awaitReady();
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }

        if (server.getPort() > 0) {
            webView.loadUrl("http://127.0.0.1:" + server.getPort() + "/");
        } else {
            Toast.makeText(this, "本地服务启动失败，请重启应用", Toast.LENGTH_LONG).show();
        }
    }

    private void applyChromeTheme(boolean dark) {
        lastDark = dark;
        int color = getColor(dark ? R.color.app_background_dark : R.color.app_background);
        if (root != null) root.setBackgroundColor(color);
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            window.setStatusBarColor(Color.TRANSPARENT);
            window.setNavigationBarColor(Color.TRANSPARENT);
            Api30.setIconAppearance(window, !dark);
        } else {
            window.setStatusBarColor(color);
            window.setNavigationBarColor(color);
        }
    }

    private void setupEdgeToEdge() {
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            Api30.apply(this, window, root);
        } else {
            window.setStatusBarColor(getColor(R.color.status_bar));
            window.setNavigationBarColor(getColor(R.color.status_bar));
        }
    }

    @android.annotation.TargetApi(30)
    static class Api30 {
        static void apply(Activity activity, Window window, View root) {
            window.setDecorFitsSystemWindows(false);
            window.setStatusBarColor(Color.TRANSPARENT);
            window.setNavigationBarColor(Color.TRANSPARENT);
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                android.graphics.Insets bars = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
                return insets;
            });
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                boolean night = (activity.getResources().getConfiguration().uiMode
                        & android.content.res.Configuration.UI_MODE_NIGHT_MASK)
                        == android.content.res.Configuration.UI_MODE_NIGHT_YES;
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(night ? 0 : mask, mask);
            }
            root.requestApplyInsets();
        }

        static void setIconAppearance(Window window, boolean lightIcons) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller == null) return;
            int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            controller.setSystemBarsAppearance(lightIcons ? 0 : mask, mask);
        }
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSupportZoom(false);
        settings.setTextZoom(100);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUserAgentString(settings.getUserAgentString() + " DeepSeekMobile/1.0 Android");
        if (Build.VERSION.SDK_INT >= 33) {
            Api33.disableAlgorithmicDarkening(settings);
        }
        if (Build.VERSION.SDK_INT >= 29) {
            Api29.disableForceDark(settings);
        }

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new AndroidBridge(), "DeepSeekAndroid");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if (scheme == null) return false;
                if (scheme.equals("http") || scheme.equals("https")) {
                    String host = uri.getHost();
                    if (host != null && (host.equals("127.0.0.1") || host.equals("localhost"))) {
                        return false;
                    }
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    Toast.makeText(MainActivity.this, "无法打开此链接", Toast.LENGTH_SHORT).show();
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                injectDownloadBridge(view);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    Uri origin = request.getOrigin();
                    boolean local = origin != null && origin.getHost() != null
                            && (origin.getHost().equals("127.0.0.1") || origin.getHost().equals("localhost"));
                    boolean wantsAudio = false;
                    for (String resource : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) wantsAudio = true;
                    }
                    if (local && wantsAudio && Build.VERSION.SDK_INT >= 23
                            && checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                            == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    } else {
                        request.deny();
                    }
                });
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin,
                                                           GeolocationPermissions.Callback callback) {
                callback.invoke(origin, false, false);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }
                fileCallback = callback;
                try {
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    String[] accept = params.getAcceptTypes();
                    String type = "*/*";
                    if (accept != null) {
                        for (String value : accept) {
                            if (value != null && value.contains("/") && !value.contains(",")) {
                                type = value;
                                break;
                            }
                        }
                    }
                    intent.setType(type);
                    if (accept != null && accept.length > 1) {
                        String[] mimeTypes = new String[accept.length];
                        int count = 0;
                        for (String value : accept) {
                            if (value != null && value.contains("/")) mimeTypes[count++] = value;
                        }
                        if (count > 0) {
                            intent.putExtra(Intent.EXTRA_MIME_TYPES, Arrays.copyOf(mimeTypes, count));
                        }
                    }
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,
                            params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                    startActivityForResult(intent, REQUEST_FILE_PICKER);
                } catch (Exception e) {
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, "无法打开文件选择器", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });

        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition,
                                        String mimeType, long contentLength) {
                if (url.startsWith("blob:") || url.startsWith("data:")) {
                    Toast.makeText(MainActivity.this, "正在导出文件…", Toast.LENGTH_SHORT).show();
                    return;
                }
                try {
                    DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                    request.setMimeType(mimeType);
                    request.addRequestHeader("User-Agent", userAgent);
                    request.setNotificationVisibility(DownloadManager.Request
                            .VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    String name = android.webkit.URLUtil.guessFileName(url, contentDisposition, mimeType);
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                    DownloadManager manager =
                            (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    if (manager != null) manager.enqueue(request);
                    Toast.makeText(MainActivity.this, "已开始下载", Toast.LENGTH_SHORT).show();
                } catch (Exception e) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    } catch (Exception ignored) {
                        Toast.makeText(MainActivity.this, "无法下载此文件", Toast.LENGTH_SHORT).show();
                    }
                }
            }
        });
    }

    private void injectDownloadBridge(WebView view) {
        String js = "(function(){"
                + "if(window.__dsDownloadBridge)return;window.__dsDownloadBridge=true;"
                + "function exportBlob(a){"
                + "var name=a.download||'download';var href=a.href;"
                + "fetch(href).then(function(r){return r.blob();}).then(function(b){"
                + "var fr=new FileReader();fr.onloadend=function(){"
                + "var s=String(fr.result);var i=s.indexOf(',')+1;"
                + "try{DeepSeekAndroid.saveFile(name,b.type||'application/octet-stream',s.slice(i));}"
                + "catch(e){DeepSeekAndroid.toast('导出失败');}"
                + "};fr.readAsDataURL(b);"
                + "}).catch(function(){DeepSeekAndroid.toast('导出失败');});"
                + "}"
                + "var originalClick=HTMLAnchorElement.prototype.click;"
                + "HTMLAnchorElement.prototype.click=function(){"
                + "try{if(this.download&&this.href&&this.href.indexOf('blob:')===0){exportBlob(this);return;}}catch(e){}"
                + "return originalClick.apply(this,arguments);"
                + "};"
                + "document.addEventListener('click',function(ev){"
                + "var t=ev.target;while(t&&t.tagName!=='A'){t=t.parentElement;}"
                + "if(!t||!t.download||!t.href||t.href.indexOf('blob:')!==0)return;"
                + "ev.preventDefault();ev.stopPropagation();exportBlob(t);"
                + "},true);"
                + "function syncChrome(){try{DeepSeekAndroid.setChromeTheme(document.body.classList.contains('dark'));}catch(e){}}"
                + "try{new MutationObserver(syncChrome).observe(document.body,{attributes:true,attributeFilter:['class','data-ds-dark-theme']});}catch(e){}"
                + "syncChrome();"
                + "})();";
        view.evaluateJavascript(js, null);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_FILE_PICKER) {
            if (fileCallback == null) return;
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            }
            fileCallback.onReceiveValue(result);
            fileCallback = null;
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions,
                                           int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_AUDIO_PERMISSION) {
            boolean granted = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (!granted) {
                Toast.makeText(this, "未获得麦克风权限，语音功能不可用", Toast.LENGTH_LONG).show();
            }
        } else if (requestCode == REQUEST_STORAGE_PERMISSION) {
            boolean granted = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (granted && pendingBase64 != null) {
                writeLegacyDownload(pendingName, pendingMime, Base64.decode(pendingBase64, Base64.DEFAULT));
            } else {
                Toast.makeText(this, "未获得存储权限，无法保存到下载目录", Toast.LENGTH_LONG).show();
            }
            pendingBase64 = null;
        }
    }

    @Override
    public void onConfigurationChanged(android.content.res.Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        setupEdgeToEdge();
        applyChromeTheme(lastDark);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (server != null) server.stopServer();
        if (webView != null) {
            root.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    public class AndroidBridge {
        @JavascriptInterface
        public String platform() {
            return "android";
        }

        @JavascriptInterface
        public int versionCode() {
            return BuildConfig.VERSION_CODE;
        }

        @JavascriptInterface
        public String versionName() {
            return BuildConfig.VERSION_NAME;
        }

        @JavascriptInterface
        public void haptic(String style) {
            int duration = "medium".equals(style) ? 22 : "warning".equals(style) ? 30 : 10;
            try {
                android.os.Vibrator vibrator = (android.os.Vibrator) getSystemService(VIBRATOR_SERVICE);
                if (vibrator == null || !vibrator.hasVibrator()) return;
                if (Build.VERSION.SDK_INT >= 26) {
                    vibrator.vibrate(android.os.VibrationEffect.createOneShot(
                            duration, android.os.VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    vibrator.vibrate(duration);
                }
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void setChromeTheme(boolean dark) {
            runOnUiThread(() -> applyChromeTheme(dark));
        }

        @JavascriptInterface
        public void toast(String message) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show());
        }

        @JavascriptInterface
        public void saveFile(String name, String mime, String base64) {
            if (base64 == null || base64.isEmpty()) {
                toast("导出内容为空");
                return;
            }
            String safeName = sanitizeFileName(name);
            byte[] bytes;
            try {
                bytes = Base64.decode(base64, Base64.DEFAULT);
            } catch (Exception e) {
                toast("导出失败：数据解码错误");
                return;
            }
            if (Build.VERSION.SDK_INT >= 29) {
                writeModernDownload(safeName, mime, bytes);
            } else if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    == PackageManager.PERMISSION_GRANTED) {
                writeLegacyDownload(safeName, mime, bytes);
            } else {
                pendingBase64 = base64;
                pendingName = safeName;
                pendingMime = mime;
                runOnUiThread(() -> requestPermissions(
                        new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE},
                        REQUEST_STORAGE_PERMISSION));
            }
        }

        @JavascriptInterface
        public void shareFile(String name, String mime, String base64) {
            String safeName = sanitizeFileName(name);
            byte[] bytes;
            try {
                bytes = Base64.decode(base64, Base64.DEFAULT);
            } catch (Exception e) {
                toast("分享失败：数据解码错误");
                return;
            }
            File file = new File(ExportProvider.exportDir(MainActivity.this), safeName);
            try {
                try (FileOutputStream out = new FileOutputStream(file)) {
                    out.write(bytes);
                }
                Uri uri = ExportProvider.uriFor(MainActivity.this, safeName);
                Intent intent = new Intent(Intent.ACTION_SEND);
                intent.setType(mime == null ? "application/octet-stream" : mime);
                intent.putExtra(Intent.EXTRA_STREAM, uri);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                runOnUiThread(() -> startActivity(Intent.createChooser(intent, "分享文件")));
            } catch (Exception e) {
                toast("分享失败");
            }
        }
    }

    @android.annotation.TargetApi(33)
    static class Api33 {
        static void disableAlgorithmicDarkening(WebSettings settings) {
            settings.setAlgorithmicDarkeningAllowed(false);
        }
    }

    @android.annotation.TargetApi(29)
    static class Api29 {
        static void disableForceDark(WebSettings settings) {
            settings.setForceDark(WebSettings.FORCE_DARK_OFF);
        }

        static void saveToDownloads(Activity activity, String name, String mime, byte[] bytes) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            values.put(MediaStore.MediaColumns.MIME_TYPE,
                    mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH,
                    Environment.DIRECTORY_DOWNLOADS + "/DeepSeek");
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri uri = null;
            try {
                uri = activity.getContentResolver()
                        .insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new IOException("insert failed");
                try (OutputStream out = activity.getContentResolver().openOutputStream(uri)) {
                    if (out == null) throw new IOException("open failed");
                    out.write(bytes);
                    out.flush();
                }
                values.clear();
                values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                activity.getContentResolver().update(uri, values, null, null);
                activity.runOnUiThread(() -> Toast.makeText(activity,
                        "已保存到 下载/DeepSeek/" + name, Toast.LENGTH_SHORT).show());
            } catch (Exception e) {
                if (uri != null) {
                    try {
                        activity.getContentResolver().delete(uri, null, null);
                    } catch (Exception ignored) {
                    }
                }
                String message = e.getMessage();
                activity.runOnUiThread(() -> Toast.makeText(activity,
                        "保存失败：" + message, Toast.LENGTH_SHORT).show());
            }
        }
    }

    private void toast(String message) {
        runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show());
    }

    private static String sanitizeFileName(String name) {
        if (name == null || name.trim().isEmpty()) return "deepseek-export";
        String safe = name.replace('/', '_').replace('\\', '_').replace("..", "_");
        safe = safe.replaceAll("[\\p{Cntrl}]", "");
        if (safe.length() > 120) safe = safe.substring(0, 120);
        return safe;
    }

    private void writeModernDownload(String name, String mime, byte[] bytes) {
        Api29.saveToDownloads(this, name, mime, bytes);
    }

    private void writeLegacyDownload(String name, String mime, byte[] bytes) {
        File dir = new File(Environment.getExternalStoragePublicDirectory(
                Environment.DIRECTORY_DOWNLOADS), "DeepSeek");
        if (!dir.exists() && !dir.mkdirs()) {
            toast("保存失败：无法创建目录");
            return;
        }
        File file = new File(dir, name);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
            out.flush();
            android.media.MediaScannerConnection.scanFile(this,
                    new String[]{file.getAbsolutePath()}, new String[]{mime}, null);
            toast("已保存到 下载/DeepSeek/" + name);
        } catch (Exception e) {
            toast("保存失败：" + e.getMessage());
        }
    }

    static class AssetServer implements Runnable {
        private final Context context;
        private final CountDownLatch ready = new CountDownLatch(1);
        private ServerSocket serverSocket;
        private volatile int port = -1;
        private volatile boolean running = true;
        private Thread thread;

        AssetServer(Context context) {
            this.context = context;
        }

        void start() {
            thread = new Thread(this, "deepseek-asset-server");
            thread.setDaemon(true);
            thread.start();
        }

        void awaitReady() throws InterruptedException {
            ready.await();
        }

        int getPort() {
            return port;
        }

        @Override
        public void run() {
            try {
                serverSocket = new ServerSocket();
                serverSocket.setReuseAddress(true);
                serverSocket.bind(new InetSocketAddress(
                        InetAddress.getByName("127.0.0.1"), 48124));
                port = serverSocket.getLocalPort();
            } catch (Exception e) {
                port = -1;
                ready.countDown();
                return;
            }
            ready.countDown();
            while (running && !serverSocket.isClosed()) {
                try {
                    Socket socket = serverSocket.accept();
                    Thread handler = new Thread(() -> handle(socket), "deepseek-http");
                    handler.setDaemon(true);
                    handler.start();
                } catch (IOException e) {
                    if (running) continue;
                }
            }
        }

        void stopServer() {
            running = false;
            try {
                if (serverSocket != null) serverSocket.close();
            } catch (IOException ignored) {
            }
        }

        private void handle(Socket socket) {
            try (Socket s = socket) {
                s.setSoTimeout(15000);
                InputStream in = s.getInputStream();
                ByteArrayOutputStream head = new ByteArrayOutputStream();
                int b;
                int matched = 0;
                byte[] end = new byte[]{'\r', '\n', '\r', '\n'};
                while ((b = in.read()) != -1) {
                    head.write(b);
                    if (b == end[matched]) {
                        matched++;
                        if (matched == end.length) break;
                    } else {
                        matched = b == '\r' ? 1 : 0;
                    }
                    if (head.size() > 16384) break;
                }
                String request = head.toString(StandardCharsets.ISO_8859_1.name());
                String[] lines = request.split("\r\n");
                if (lines.length == 0) return;
                String[] requestLine = lines[0].split(" ");
                if (requestLine.length < 2) return;
                String method = requestLine[0];
                String target = requestLine[1];
                boolean headOnly = method.equals("HEAD");
                if (!method.equals("GET") && !headOnly) {
                    writeError(s.getOutputStream(), 405, "Method Not Allowed", headOnly);
                    return;
                }

                int query = target.indexOf('?');
                if (query >= 0) target = target.substring(0, query);
                int hash = target.indexOf('#');
                if (hash >= 0) target = target.substring(0, hash);
                String path;
                try {
                    path = java.net.URLDecoder.decode(target, "UTF-8");
                } catch (Exception e) {
                    path = target;
                }
                if (path.startsWith("/")) path = path.substring(1);
                if (path.isEmpty()) path = "index.html";
                if (path.contains("..") || path.contains("\\") || path.indexOf('\0') >= 0) {
                    writeError(s.getOutputStream(), 403, "Forbidden", headOnly);
                    return;
                }

                String served = path;
                byte[] body = readAsset("web/" + path);
                if (body == null && !path.contains(".")) {
                    served = "index.html";
                    body = readAsset("web/index.html");
                }
                if (body == null) {
                    writeError(s.getOutputStream(), 404, "Not Found", headOnly);
                    return;
                }

                String mime = mimeFor(served);
                OutputStream out = s.getOutputStream();
                String header = "HTTP/1.1 200 OK\r\n"
                        + "Content-Type: " + mime + "\r\n"
                        + "Content-Length: " + body.length + "\r\n"
                        + "Cache-Control: no-cache\r\n"
                        + "X-Content-Type-Options: nosniff\r\n"
                        + "Connection: close\r\n\r\n";
                out.write(header.getBytes(StandardCharsets.ISO_8859_1));
                if (!headOnly) out.write(body);
                out.flush();
            } catch (Exception ignored) {
            }
        }

        private byte[] readAsset(String path) {
            try (InputStream in = context.getAssets().open(path)) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int n;
                while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
                return out.toByteArray();
            } catch (Exception e) {
                return null;
            }
        }

        private void writeError(OutputStream out, int code, String message, boolean headOnly)
                throws IOException {
            byte[] body = message.getBytes(StandardCharsets.UTF_8);
            String header = "HTTP/1.1 " + code + " " + message + "\r\n"
                    + "Content-Type: text/plain; charset=utf-8\r\n"
                    + "Content-Length: " + body.length + "\r\n"
                    + "Connection: close\r\n\r\n";
            out.write(header.getBytes(StandardCharsets.ISO_8859_1));
            if (!headOnly) out.write(body);
            out.flush();
        }

        private String mimeFor(String path) {
            String lower = path.toLowerCase(Locale.US);
            if (lower.endsWith(".html")) return "text/html; charset=utf-8";
            if (lower.endsWith(".js")) return "text/javascript; charset=utf-8";
            if (lower.endsWith(".css")) return "text/css; charset=utf-8";
            if (lower.endsWith(".json")) return "application/json; charset=utf-8";
            if (lower.endsWith(".svg")) return "image/svg+xml";
            if (lower.endsWith(".png")) return "image/png";
            if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
            if (lower.endsWith(".webp")) return "image/webp";
            if (lower.endsWith(".gif")) return "image/gif";
            if (lower.endsWith(".ico")) return "image/x-icon";
            if (lower.endsWith(".woff2")) return "font/woff2";
            if (lower.endsWith(".woff")) return "font/woff";
            if (lower.endsWith(".ttf")) return "font/ttf";
            if (lower.endsWith(".mp3")) return "audio/mpeg";
            if (lower.endsWith(".wav")) return "audio/wav";
            if (lower.endsWith(".mp4")) return "video/mp4";
            if (lower.endsWith(".pdf")) return "application/pdf";
            if (lower.endsWith(".zip")) return "application/zip";
            String ext = MimeTypeMap.getFileExtensionFromUrl(path);
            String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
            return mime == null ? "application/octet-stream" : mime;
        }
    }
}
