import AppKit
import Foundation
import Vision
import WebKit

private let maximumOCRCharacters = 8_192
private let maximumPageWidth: CGFloat = 2_048
private let maximumPageHeight: CGFloat = 4_096

private struct PageReceipt: Codable {
    let width: Int
    let height: Int
    let nonWhitePixels: Int
    let ocrText: String
}

private final class LocalOnlyDelegate: NSObject, WKNavigationDelegate {
    let input: URL
    let root: URL
    let output: URL

    init(input: URL, output: URL) {
        self.input = input.standardizedFileURL
        self.root = input.deletingLastPathComponent().standardizedFileURL
        self.output = output
    }

    private func fail(_ message: String, code: Int32) -> Never {
        fputs("docx page render failed: \(message)\n", stderr)
        exit(code)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url, url.isFileURL else {
            decisionHandler(.cancel)
            return
        }
        let path = url.standardizedFileURL.path
        let rootPath = root.path.hasSuffix("/") ? root.path : root.path + "/"
        guard url.standardizedFileURL == input || path.hasPrefix(rootPath) else {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    private func pixelFacts(_ image: CGImage) -> (Int, Int, Int) {
        let width = image.width
        let height = image.height
        let bytesPerRow = width * 4
        var pixels = [UInt8](repeating: 255, count: bytesPerRow * height)
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let context = CGContext(
            data: &pixels, width: width, height: height, bitsPerComponent: 8,
            bytesPerRow: bytesPerRow, space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        )!
        context.setFillColor(NSColor.white.cgColor)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        var nonWhite = 0
        for offset in stride(from: 0, to: pixels.count, by: 4) {
            if pixels[offset] < 250 || pixels[offset + 1] < 250 || pixels[offset + 2] < 250 {
                nonWhite += 1
            }
        }
        return (width, height, nonWhite)
    }

    private func recognize(_ image: CGImage) -> String {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["ko-KR", "en-US"]
        request.usesLanguageCorrection = false
        do {
            try VNImageRequestHandler(cgImage: image).perform([request])
        } catch {
            return ""
        }
        let joined = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
            .joined(separator: " ")
        return String(joined.prefix(maximumOCRCharacters))
    }

    private func snapshot(_ webView: WKWebView) {
        let snapshot = WKSnapshotConfiguration()
        snapshot.rect = webView.bounds
        snapshot.afterScreenUpdates = true
        webView.takeSnapshot(with: snapshot) { image, error in
            guard error == nil, let image,
                  let tiff = image.tiffRepresentation,
                  let bitmap = NSBitmapImageRep(data: tiff),
                  let png = bitmap.representation(using: .png, properties: [:]),
                  let cgImage = bitmap.cgImage else {
                self.fail(error?.localizedDescription ?? "snapshot unavailable", code: 3)
            }
            do {
                try png.write(to: self.output, options: .atomic)
                let (width, height, nonWhite) = self.pixelFacts(cgImage)
                let receipt = PageReceipt(
                    width: width, height: height, nonWhitePixels: nonWhite,
                    ocrText: self.recognize(cgImage)
                )
                let encoded = try JSONEncoder().encode(receipt)
                FileHandle.standardOutput.write(encoded)
                FileHandle.standardOutput.write(Data([0x0a]))
                NSApplication.shared.terminate(nil)
            } catch {
                self.fail(error.localizedDescription, code: 4)
            }
        }
    }

    private func contentSize(_ view: NSView) -> NSSize? {
        if let scrollView = view as? NSScrollView, let documentView = scrollView.documentView {
            return documentView.bounds.size
        }
        for child in view.subviews {
            if let size = contentSize(child), size.width > 0, size.height > 0 { return size }
        }
        return nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let content = contentSize(webView) ?? webView.bounds.size
        let width = max(webView.bounds.width, ceil(content.width))
        let height = max(webView.bounds.height, ceil(content.height))
        guard width <= maximumPageWidth, height <= maximumPageHeight else {
            fail("page dimensions exceed the limit", code: 5)
        }
        webView.setFrameSize(NSSize(width: width, height: height))
        webView.layoutSubtreeIfNeeded()
        DispatchQueue.main.async { self.snapshot(webView) }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fail(error.localizedDescription, code: 2)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fail(error.localizedDescription, code: 2)
    }
}

guard CommandLine.arguments.count == 3 else {
    fputs("usage: t5-docx-page-renderer page.html page.png\n", stderr)
    exit(64)
}

let input = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
let output = URL(fileURLWithPath: CommandLine.arguments[2]).standardizedFileURL
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)

let pagePreferences = WKWebpagePreferences()
pagePreferences.allowsContentJavaScript = false
let preferences = WKPreferences()
preferences.javaScriptCanOpenWindowsAutomatically = false
let configuration = WKWebViewConfiguration()
configuration.defaultWebpagePreferences = pagePreferences
configuration.preferences = preferences
configuration.websiteDataStore = .nonPersistent()

private let delegate = LocalOnlyDelegate(input: input, output: output)
let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 612, height: 792), configuration: configuration)
webView.navigationDelegate = delegate
webView.loadFileURL(input, allowingReadAccessTo: input.deletingLastPathComponent())
app.run()
