import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = CAPBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    /// スリープ中に iOS が WebView の表示プロセスを終了させると、復帰時に黒い画面のまま
    /// 戻らないことがある。復帰時に応答を確かめ、応答がなければ読み込み直す
    /// （閲覧位置は保存済みなので、同じページに戻る）。
    func sceneWillEnterForeground(_ scene: UIScene) {
        guard let controller = window?.rootViewController as? CAPBridgeViewController,
              let webView = controller.webView else { return }
        let reload = {
            if webView.url != nil {
                webView.reload()
            } else if let bridge = controller.bridge {
                webView.load(URLRequest(url: bridge.config.serverURL))
            }
        }
        if webView.url == nil {
            reload()
            return
        }
        var answered = false
        webView.evaluateJavaScript("document.readyState") { result, error in
            answered = true
            if error != nil || result == nil { reload() }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            if !answered { reload() }
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
