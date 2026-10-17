import Foundation
import UIKit
import Capacitor

/// 登録した PDF・画像を iOS の印刷画面（AirPrint）で印刷するプラグイン。
/// JS 側で一時フォルダに書き出したファイルの URL を受け取る。
@objc(PrintPlugin)
public class PrintPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PrintPlugin"
    public let jsName = "Printer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "print", returnType: CAPPluginReturnPromise)
    ]

    @objc func print(_ call: CAPPluginCall) {
        let urls = (call.getArray("urls", String.self) ?? []).compactMap { URL(string: $0) }
        let jobName = call.getString("jobName") ?? "編み図ライブラリ"
        guard !urls.isEmpty, urls.allSatisfy({ UIPrintInteractionController.canPrint($0) }) else {
            call.reject("このファイルは印刷できません", "UNPRINTABLE")
            return
        }
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController else {
                call.reject("no view controller", "UNAVAILABLE")
                return
            }
            let controller = UIPrintInteractionController.shared
            let info = UIPrintInfo(dictionary: nil)
            info.jobName = jobName
            info.outputType = .general
            controller.printInfo = info
            if urls.count == 1 {
                controller.printingItem = urls[0]
            } else {
                controller.printingItems = urls
            }
            let completion: UIPrintInteractionController.CompletionHandler = { _, completed, error in
                if let error = error {
                    call.reject(error.localizedDescription, "FAILED")
                } else {
                    call.resolve(["completed": completed])
                }
            }
            if UIDevice.current.userInterfaceIdiom == .pad {
                // iPad は画面上部の中央から吹き出しで表示する
                let rect = CGRect(x: host.view.bounds.midX, y: host.view.safeAreaInsets.top + 8, width: 1, height: 1)
                controller.present(from: rect, in: host.view, animated: true, completionHandler: completion)
            } else {
                controller.present(animated: true, completionHandler: completion)
            }
        }
    }
}
