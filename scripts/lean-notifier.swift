import AppKit
import UserNotifications

final class Notifier: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    let args = CommandLine.arguments
    let center = UNUserNotificationCenter.current()
    func value(_ flag: String) -> String? {
        guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
        return args[i + 1]
    }
    func finish(_ result: [String: Any]) {
        if let path = value("--result"), let data = try? JSONSerialization.data(withJSONObject: result) {
            try? data.write(to: URL(fileURLWithPath: path), options: .atomic)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path)
        }
        DispatchQueue.main.async { NSApp.terminate(nil) }
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        center.delegate = self
        if args.contains("--authorize") {
            center.requestAuthorization(options: [.alert]) { allowed, error in
                self.finish(["authorized": allowed, "error": error?.localizedDescription ?? ""])
            }
        } else if args.contains("--status") {
            center.getNotificationSettings { settings in
                self.finish(["authorized": settings.authorizationStatus == .authorized,
                             "alerts_enabled": settings.alertSetting == .enabled,
                             "notification_center_enabled": settings.notificationCenterSetting == .enabled])
            }
        } else if let path = value("--notify") {
            do {
                let object = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: path)))
                guard let payload = object as? [String: Any], let count = payload["count"] as? Int, count > 0,
                      let list = payload["path"] as? String, let id = payload["id"] as? String else {
                    finish(["accepted": false, "error": "Invalid notification payload"]); return
                }
                center.getNotificationSettings { settings in
                    guard settings.authorizationStatus == .authorized else {
                        self.finish(["accepted": false, "error": "Enable notifications for CareerOps Notifier in System Settings"]); return
                    }
                    let content = UNMutableNotificationContent()
                    content.title = "Career Ops：\(count) 个新增候选岗位"
                    content.body = "已完成本地筛选；点击打开岗位清单。签证与完整 JD 仍需核实。"
                    content.userInfo = ["path": list]
                    UserDefaults.standard.set(list, forKey: "shortlist")
                    self.center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil)) { error in
                        self.finish(["accepted": error == nil, "error": error?.localizedDescription ?? ""])
                    }
                }
            } catch { finish(["accepted": false, "error": error.localizedDescription]) }
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                if let path = UserDefaults.standard.string(forKey: "shortlist") { NSWorkspace.shared.open(URL(fileURLWithPath: path)) }
                self.finish(["opened": true])
            }
        }
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        if let path = response.notification.request.content.userInfo["path"] as? String { NSWorkspace.shared.open(URL(fileURLWithPath: path)) }
        completionHandler(); finish(["opened": true])
    }
}
let app = NSApplication.shared
let delegate = Notifier()
app.setActivationPolicy(.accessory)
app.delegate = delegate
app.run()
