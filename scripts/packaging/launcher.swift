// GPAO-T5 앱 진입점 (macOS 설치본 전용 · 제품 코드가 아니다)
//
// 왜 필요한가: 진입점이 셸 스크립트면 Dock 에는 뜨지만 **종료가 안 된다**(실측:
// AppleEvent -1712 시간 초과 — 이벤트 루프가 없다). 그러면 사용자가 끄는 방법이
// 터미널뿐이고, 그건 비개발자용 제품이 아니다.
//
// 하는 일은 넷뿐이다.
//   ① 동봉 런타임으로 제품 서버를 자식 프로세스로 띄운다(시스템 Node 폴백 없음)
//   ② 사람이 볼 수 있게 Dock 에 서고 ⌘Q·종료를 받는다
//   ③ 끝날 때 자식을 반드시 데려간다(고아 0)
//   ④ **사람이 아이콘을 누르면 화면을 연다**
// 서버가 못 뜨면 조용히 죽지 않고 사람 말로 알린다.
//
// ④ 가 왜 런처의 일인가: 이 앱에는 창이 없다. 화면은 브라우저에 있다. 그래서 아이콘을 눌러도
// 아무 일이 없으면 사용자에게 T5 는 **고장난 프로그램**이다(실측: 로그인 자동시작으로 떠 있는
// 상태에서 아이콘을 눌러도 탭이 하나도 열리지 않았다). 화면을 여는 책임을 서버 진입점과
// 나눠 가지면 "누가 여는가"가 상황마다 달라져 이런 구멍이 난다. 그래서 **런처 한 곳**으로 모은다 —
// 서버에는 항상 --no-open 을 주고, 열지 말지는 여기서만 정한다.
import AppKit

final class Launcher: NSObject, NSApplicationDelegate {
  var child: Process?

  /// 로그인 자동시작에서는 화면을 띄우지 않는다. 사람이 부른 실행에서만 띄운다.
  let 자동시작 = ProcessInfo.processInfo.environment["GPAO_T5_LOGIN_START"] == "1"

  func applicationDidFinishLaunching(_ note: Notification) {
    // **중복 실행 0.** 같은 번들이 이미 떠 있으면 그쪽을 앞으로 부르고 나는 조용히 빠진다.
    // (아이콘을 두 번 눌러 서버가 둘 뜨면 포트가 충돌하고 사용자는 이유를 모른다.)
    let 나 = ProcessInfo.processInfo.processIdentifier
    let 이미 = NSWorkspace.shared.runningApplications.filter {
      $0.bundleIdentifier == Bundle.main.bundleIdentifier && $0.processIdentifier != 나
    }
    if let 먼저 = 이미.first {
      먼저.activate()
      // 이미 켜져 있는데 또 눌렀다면 사람이 원한 건 **화면**이다. 앞으로 부르기만 하고 빠지면
      // 아이콘을 눌러도 아무 일이 없는 것으로 보인다.
      if 자동시작 { NSApp.terminate(nil) } else { 화면열기 { NSApp.terminate(nil) } }
      return
    }
    let res = Bundle.main.resourceURL!
    let node = res.appendingPathComponent("runtime/bin/node")
    let entry = res.appendingPathComponent("app/bin/gpao-t5.mjs")

    guard FileManager.default.isExecutableFile(atPath: node.path) else {
      alert("설치본이 손상됐어요", "다시 설치하면 바로 쓸 수 있어요.")
      NSApp.terminate(nil); return
    }

    let p = Process()
    p.executableURL = node
    // 서버는 **절대 스스로 화면을 열지 않는다.** 여는 것은 런처 한 곳의 일이다(파일 머리말 ④).
    p.arguments = [entry.path, "--no-open"]
    // 서버가 죽으면 앱도 같이 끝난다 — 아이콘만 남아 도는 것처럼 보이지 않게.
    p.terminationHandler = { proc in
      DispatchQueue.main.async {
        if proc.terminationStatus != 0 {
          self.alert("GPAO-T5 를 시작하지 못했어요",
                     "다른 프로그램이 같은 자리를 쓰고 있을 수 있어요. 잠시 뒤 다시 열어 보세요.")
        }
        NSApp.terminate(nil)
      }
    }
    do { try p.run() } catch {
      alert("GPAO-T5 를 시작하지 못했어요", "다시 열어 보시고, 계속 안 되면 다시 설치해 주세요.")
      NSApp.terminate(nil); return
    }
    child = p
    if !자동시작 { 화면열기() }
  }

  /// Dock 아이콘을 눌렀을 때(창 없는 앱이라 macOS 는 이걸로 알려 준다). **여기가 매일 쓰는 길이다.**
  func applicationShouldHandleReopen(_ app: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    화면열기()
    return true
  }

  // ── 화면 열기 ──────────────────────────────────────────────────────
  private var 마지막열기: Date?

  private var 데이터폴더: URL {
    if let d = ProcessInfo.processInfo.environment["GPAO_T5_DATA_DIR"], !d.isEmpty {
      return URL(fileURLWithPath: d)
    }
    return FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent(".local/state/gpao-t5/sessions")
  }

  /// 자리표에 적힌 **실제 자리**. 기본 자리를 다른 프로그램이 쓰면 T5 는 옮겨 뜨므로,
  /// 4173 을 박아 두면 그 순간부터 빈 화면이 열린다.
  private func 지금자리() -> Int? {
    let f = 데이터폴더.appendingPathComponent("locator.json")
    guard let d = try? Data(contentsOf: f),
          let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
          let p = j["port"] as? Int, p > 0 else { return nil }
    return p
  }

  /// 서버가 **답할 때까지 기다렸다가** 연다. 안 기다리고 열면 브라우저가 오류 화면을 띄우고,
  /// 사용자는 그걸 "T5 가 고장났다"로 읽는다.
  private func 화면열기(_ 완료: (() -> Void)? = nil) {
    // 아이콘 한 번에 탭 하나. macOS 가 실행과 reopen 을 잇달아 보낼 수 있어 짧은 시간 안의
    // 두 번째 요청은 같은 요청으로 본다.
    if let 앞 = 마지막열기, Date().timeIntervalSince(앞) < 5 { 완료?(); return }
    마지막열기 = Date()
    DispatchQueue.global().async {
      let 끝 = Date().addingTimeInterval(40)
      while Date() < 끝 {
        if let p = self.지금자리(),
           let h = URL(string: "http://127.0.0.1:\(p)/health"),
           let d = try? Data(contentsOf: h), !d.isEmpty,
           let 열자리 = URL(string: "http://localhost:\(p)") {
          DispatchQueue.main.async { NSWorkspace.shared.open(열자리); 완료?() }
          return
        }
        usleep(300_000)
      }
      // 끝내 안 뜨면 조용히 넘어가지 않는다 — 아이콘을 눌렀는데 아무 일도 없는 것이 제일 나쁘다.
      DispatchQueue.main.async {
        self.alert("GPAO-T5 화면을 열지 못했어요", "잠시 뒤 아이콘을 다시 눌러 주세요.")
        완료?()
      }
    }
  }

  // 끝날 때 자식을 데려간다. 이게 없으면 앱을 껐는데 서버만 남는다.
  func applicationWillTerminate(_ note: Notification) {
    guard let c = child, c.isRunning else { return }
    c.terminate()
    // 정리에 잠깐 시간을 준다 — 그래도 안 끝나면 확실히 끝낸다.
    let deadline = Date().addingTimeInterval(3)
    while c.isRunning && Date() < deadline { usleep(50_000) }
    if c.isRunning { kill(c.processIdentifier, SIGKILL) }
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { false }

  private func alert(_ title: String, _ body: String) {
    let a = NSAlert()
    a.messageText = title
    a.informativeText = body
    a.alertStyle = .warning
    a.runModal()
  }
}

let app = NSApplication.shared
let delegate = Launcher()
app.delegate = delegate
app.setActivationPolicy(.regular)   // Dock 에 선다 — 켜진 것이 보이고 ⌘Q 로 끌 수 있다
app.run()
