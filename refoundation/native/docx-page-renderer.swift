import AppKit
import Foundation
import Vision
import WebKit

private let maximumOCRCharacters = 8_192
private let maximumPageWidth: CGFloat = 2_048
private let maximumPageHeight: CGFloat = 4_096

private struct OCRBox: Codable { let x: Double; let y: Double; let width: Double; let height: Double }
private struct OCRItem: Codable { let text: String; let confidence: Float; let box: OCRBox }
private struct OCRReceipt: Codable {
    let schema: String; let width: Int; let height: Int; let observations: [OCRItem]
    let truncated: Bool; let recognitionLanguages: [String]
}

private func recognizeImage(_ url: URL) -> Never {
    guard let image = NSImage(contentsOf: url),
          let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil),
          cgImage.width > 0, cgImage.height > 0,
          cgImage.width <= 12_000, cgImage.height <= 12_000 else {
        fputs("image OCR failed: unsupported image\n", stderr); exit(65)
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["ko-KR", "en-US"]
    request.usesLanguageCorrection = false
    do { try VNImageRequestHandler(cgImage: cgImage).perform([request]) }
    catch { fputs("image OCR failed: \(error.localizedDescription)\n", stderr); exit(66) }
    let all = (request.results ?? []).compactMap { observation -> OCRItem? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let box = observation.boundingBox
        return OCRItem(text: String(candidate.string.prefix(1_000)), confidence: candidate.confidence,
                       box: OCRBox(x: box.origin.x, y: box.origin.y, width: box.width, height: box.height))
    }.sorted { left, right in
        if abs(left.box.y - right.box.y) > 0.01 { return left.box.y > right.box.y }
        return left.box.x < right.box.x
    }
    let limit = 200; let items = Array(all.prefix(limit))
    let receipt = OCRReceipt(schema: "t5.local-image-ocr.v1", width: cgImage.width, height: cgImage.height,
                             observations: items, truncated: all.count > limit,
                             recognitionLanguages: ["ko-KR", "en-US"])
    do { FileHandle.standardOutput.write(try JSONEncoder().encode(receipt)); FileHandle.standardOutput.write(Data([0x0a])); exit(0) }
    catch { fputs("image OCR failed: receipt encoding\n", stderr); exit(67) }
}

private struct PageReceipt: Codable {
    let width: Int
    let height: Int
    let nonWhitePixels: Int
    let ocrText: String
    let dom: DOMReceipt?
}

private struct DOMReceipt: Codable {
    let viewportWidth: Int
    let viewportHeight: Int
    let scrollWidth: Int
    let scrollHeight: Int
    let artboardCount: Int
    let observedBlockCount: Int
    let overflowElementCount: Int
    let overlapPairCount: Int
    let textCharacters: Int
    let headingCount: Int
    let tableCount: Int
    let imageCount: Int
    let imagesMissingAlt: Int
    let figureCount: Int
    let figuresMissingCaption: Int
    let contrastFailureCount: Int
    let contrastUnmeasuredCount: Int
    let minimumTextSizePx: Double?
    let requestedFontFamilies: [String]
    let unavailableFontFamilies: [String]
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

    private func snapshot(_ webView: WKWebView, dom: DOMReceipt?) {
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
                    ocrText: self.recognize(cgImage), dom: dom
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

    private let domObservationScript = #"""
    (() => {
      const finite = value => Number.isFinite(value) ? value : 0;
      const rect = element => element.getBoundingClientRect();
      const blocks = [...document.querySelectorAll('[data-vd-block]')];
      let overflowElementCount = 0;
      for (const element of document.querySelectorAll('body *')) {
        if (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) {
          overflowElementCount += 1;
        }
      }
      let overlapPairCount = 0;
      for (let left = 0; left < blocks.length; left += 1) for (let right = left + 1; right < blocks.length; right += 1) {
        const a = blocks[left], b = blocks[right];
        if (a.contains(b) || b.contains(a)) continue;
        const ar = rect(a), br = rect(b);
        const width = Math.min(ar.right, br.right) - Math.max(ar.left, br.left);
        const height = Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top);
        if (width > 1 && height > 1) overlapPairCount += 1;
      }
      const parseColor = value => {
        const match = String(value || '').match(/rgba?\((\d+(?:\.\d+)?)[, ]+(\d+(?:\.\d+)?)[, ]+(\d+(?:\.\d+)?)(?:[, /]+(\d+(?:\.\d+)?))?\)/);
        if (!match) return null;
        return { r:+match[1], g:+match[2], b:+match[3], a:match[4] == null ? 1 : +match[4] };
      };
      const luminance = color => {
        const channel = value => { const c=value/255; return c<=0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4); };
        return 0.2126*channel(color.r)+0.7152*channel(color.g)+0.0722*channel(color.b);
      };
      const background = element => {
        for (let current=element; current; current=current.parentElement) {
          const style=getComputedStyle(current);
          if (style.backgroundImage && style.backgroundImage !== 'none') return null;
          const color=parseColor(style.backgroundColor);
          if (color && color.a >= 0.99) return color;
        }
        return {r:255,g:255,b:255,a:1};
      };
      let contrastFailureCount = 0;
      let contrastUnmeasuredCount = 0;
      let minimumTextSizePx = null;
      const fonts = new Set();
      for (const element of document.querySelectorAll('body *')) {
        if (![...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) continue;
        const style=getComputedStyle(element), foreground=parseColor(style.color), bg=background(element);
        const size=parseFloat(style.fontSize), weight=parseInt(style.fontWeight,10) || 400;
        if (Number.isFinite(size)) minimumTextSizePx = minimumTextSizePx == null ? size : Math.min(minimumTextSizePx,size);
        String(style.fontFamily || '').split(',').map(value=>value.trim().replace(/^['"]|['"]$/g,'')).filter(Boolean).forEach(value=>fonts.add(value));
        if (!foreground || foreground.a < 0.99 || !bg) { contrastUnmeasuredCount += 1; continue; }
        const lighter=Math.max(luminance(foreground),luminance(bg)), darker=Math.min(luminance(foreground),luminance(bg));
        const ratio=(lighter+0.05)/(darker+0.05), large=size >= 24 || (size >= 18.66 && weight >= 700);
        if (ratio < (large ? 3 : 4.5)) contrastFailureCount += 1;
      }
      const requestedFontFamilies=[...fonts].sort();
      const generic=new Set(['serif','sans-serif','monospace','cursive','fantasy','system-ui','ui-serif','ui-sans-serif','ui-monospace']);
      const unavailableFontFamilies=requestedFontFamilies.filter(name => !generic.has(name.toLowerCase()) && document.fonts && !document.fonts.check(`16px "${name.replace(/"/g,'')}"`));
      const images=[...document.images], figures=[...document.querySelectorAll('figure')];
      return {
        viewportWidth: Math.round(window.innerWidth), viewportHeight: Math.round(window.innerHeight),
        scrollWidth: Math.round(Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0)),
        scrollHeight: Math.round(Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0)),
        artboardCount: document.querySelectorAll('[data-vd-artboard]').length || 1,
        observedBlockCount: blocks.length, overflowElementCount, overlapPairCount,
        textCharacters: (document.body?.innerText || '').length,
        headingCount: document.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
        tableCount: document.querySelectorAll('table').length,
        imageCount: images.length,
        imagesMissingAlt: images.filter(image => !image.hasAttribute('alt')).length,
        figureCount: figures.length,
        figuresMissingCaption: figures.filter(figure => !figure.querySelector('figcaption')).length,
        contrastFailureCount, contrastUnmeasuredCount, minimumTextSizePx,
        requestedFontFamilies, unavailableFontFamilies,
      };
    })()
    """#

    private func observeDOM(_ webView: WKWebView) {
        webView.evaluateJavaScript(domObservationScript) { value, _ in
            var receipt: DOMReceipt? = nil
            if let value, JSONSerialization.isValidJSONObject(value),
               let data = try? JSONSerialization.data(withJSONObject: value),
               let decoded = try? JSONDecoder().decode(DOMReceipt.self, from: data) {
                receipt = decoded
            }
            self.snapshot(webView, dom: receipt)
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
        DispatchQueue.main.async { self.observeDOM(webView) }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fail(error.localizedDescription, code: 2)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fail(error.localizedDescription, code: 2)
    }
}

if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "--ocr-image" {
    recognizeImage(URL(fileURLWithPath: CommandLine.arguments[2]).standardizedFileURL)
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
