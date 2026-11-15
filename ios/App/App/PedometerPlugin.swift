import Foundation
import UIKit
import CoreMotion
import Capacitor

@objc(PedometerPlugin)
public class PedometerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PedometerPlugin"
    public let jsName = "Pedometer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "today", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]
    private let pedometer = CMPedometer()
    private var generation = 0
    private var wantsUpdates = false
    private var observers: [NSObjectProtocol] = []
    public override func load() {
        observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self = self else { return }
            self.generation += 1
            self.pedometer.stopUpdates()
        })
        observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            if let self = self, self.wantsUpdates { self.beginUpdates() }
        })
    }
    private func day(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .autoupdatingCurrent
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
    private func beginUpdates() {
        generation += 1
        let token = generation
        pedometer.stopUpdates()
        guard wantsUpdates && state() == "authorized" else { return }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .autoupdatingCurrent
        let now = Date()
        let start = calendar.startOfDay(for: now), date = day(now)
        pedometer.startUpdates(from: start) { [weak self] data, error in
            DispatchQueue.main.async {
                guard let self = self, self.wantsUpdates, self.generation == token else { return }
                guard self.day(Date()) == date else { self.beginUpdates(); return }
                if error != nil { self.notifyListeners("steps", data: ["error": "步数读取失败，请检查运动与健身权限"]); return }
                guard let data = data else { return }
                self.notifyListeners("steps", data: ["date": date, "steps": data.numberOfSteps.intValue])
            }
        }
    }
    @objc public func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.state() == "authorized" else { call.reject("请先允许运动与健身访问", "MOTION_DENIED"); return }
            self.wantsUpdates = true
            self.beginUpdates()
            call.resolve()
        }
    }
    @objc public func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.wantsUpdates = false
            self.generation += 1
            self.pedometer.stopUpdates()
            call.resolve()
        }
    }
    @objc public func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else { call.reject("无法打开系统设置"); return }
            UIApplication.shared.open(url, options: [:]) { success in
                if success { call.resolve() } else { call.reject("无法打开系统设置") }
            }
        }
    }
    deinit {
        pedometer.stopUpdates()
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
    }

    private func state() -> String {
        guard CMPedometer.isStepCountingAvailable() else { return "unsupported" }
        switch CMPedometer.authorizationStatus() {
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "notDetermined"
        @unknown default: return "restricted"
        }
    }
    @objc public func status(_ call: CAPPluginCall) { call.resolve(["status": state()]) }
    @objc public func today(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let status = self.state()
            guard status != "unsupported" else { call.reject("当前设备不支持自动计步", "UNSUPPORTED"); return }
            guard status != "denied" && status != "restricted" else { call.reject("请在 iPhone 设置的运动与健身中允许行食记访问", "MOTION_DENIED"); return }
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = .autoupdatingCurrent
            let end = Date(), start = calendar.startOfDay(for: end)
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = calendar.timeZone
            formatter.dateFormat = "yyyy-MM-dd"
            let date = formatter.string(from: start)
            self.pedometer.queryPedometerData(from: start, to: end) { data, error in
                if let error = error { call.reject("步数读取失败，请检查运动与健身权限后重试", "MOTION_QUERY_FAILED", error); return }
                guard let data = data else { call.reject("系统暂未返回步数，请稍后刷新", "NO_DATA"); return }
                call.resolve(["date": date, "steps": data.numberOfSteps.intValue])
            }
        }
    }
}
