// GPAO-T5 앱 진입점 (macOS 설치본 전용 · 제품 코드가 아니다)
//
// 왜 필요한가: 진입점이 셸 스크립트면 Dock 에는 뜨지만 **종료가 안 된다**(실측:
// AppleEvent -1712 시간 초과 — 이벤트 루프가 없다). 그러면 사용자가 끄는 방법이
// 터미널뿐이고, 그건 비개발자용 제품이 아니다.
//
// 하는 일은 셋뿐이다.
//   ① 동봉 런타임으로 제품 서버를 자식 프로세스로 띄운다(시스템 Node 폴백 없음)
//   ② 사람이 볼 수 있게 Dock 에 서고 ⌘Q·종료를 받는다
//   ③ 끝날 때 자식을 반드시 데려간다(고아 0)
// 서버가 못 뜨면 조용히 죽지 않고 사람 말로 알린다.
import AppKit

final class Launcher: NSObject, NSApplicationDelegate {
  var child: Process?

  func applicationDidFinishLaunching(_ note: Notification) {
    // **중복 실행 0.** 같은 번들이 이미 떠 있으면 그쪽을 앞으로 부르고 나는 조용히 빠진다.
    // (아이콘을 두 번 눌러 서버가 둘 뜨면 포트가 충돌하고 사용자는 이유를 모른다.)
    let 나 = ProcessInfo.processInfo.processIdentifier
    let 이미 = NSWorkspace.shared.runningApplications.filter {
      $0.bundleIdentifier == Bundle.main.bundleIdentifier && $0.processIdentifier != 나
    }
    if let 먼저 = 이미.first {
      먼저.activate()
      NSApp.terminate(nil); return
    }
    let res = Bundle.main.resourceURL!
    let node = res.appendingPathComponent("runtime/bin/node")
    let entry = res.appendingPathComponent("app/bin/gpao-t5.mjs")

    guard FileManager.default.isExecutableFile(atPath: node.path) else {
      alert("설치본이 손상됐어요", "다시 설치하면 바로 쓸 수 있어요.")
      NSApp.terminate(nil); return
    }

    // 로그인 자동시작에서는 브라우저를 매번 띄우지 않는다. 처음 설치했을 때와
    // 사용자가 아이콘을 눌렀을 때만 화면이 뜨는 것이 자연스럽다.
    let 자동시작 = ProcessInfo.processInfo.environment["GPAO_T5_LOGIN_START"] == "1"
    let p = Process()
    p.executableURL = node
    p.arguments = 자동시작 ? [entry.path, "--no-open"] : [entry.path]
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
