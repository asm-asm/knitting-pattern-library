import Foundation
import Capacitor
import StoreKit

/// App Store のサブスクリプションを扱うプラグイン（StoreKit 2）。
/// 購入の確認は端末内で行い、購入情報を外部のサーバーへ送らない。
@objc(StorePlugin)
public class StorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StorePlugin"
    public let jsName = "Store"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getEntitlements", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "manageSubscriptions", returnType: CAPPluginReturnPromise)
    ]

    private var updatesTask: Task<Void, Never>?

    override public func load() {
        // 更新・解約・別の端末での購入など、アプリの外で起きた変化を受け取る
        updatesTask = Task.detached { [weak self] in
            for await result in Transaction.updates {
                if case .verified(let transaction) = result {
                    await transaction.finish()
                }
                await self?.notifyEntitlementsChanged()
            }
        }
    }

    deinit {
        updatesTask?.cancel()
    }

    private func notifyEntitlementsChanged() async {
        let entitlements = await StorePlugin.currentEntitlements()
        notifyListeners("entitlementsChanged", data: ["entitlements": entitlements])
    }

    /// 現在有効な購入（Apple が署名を確認できたものだけ）
    static func currentEntitlements() async -> [[String: Any]] {
        var out: [[String: Any]] = []
        for await result in Transaction.currentEntitlements {
            guard case .verified(let t) = result, t.revocationDate == nil else { continue }
            var e: [String: Any] = [
                "productId": t.productID,
                "purchaseDate": t.purchaseDate.timeIntervalSince1970 * 1000
            ]
            if let exp = t.expirationDate {
                e["expirationDate"] = exp.timeIntervalSince1970 * 1000
            }
            out.append(e)
        }
        return out
    }

    private static func unitName(_ unit: Product.SubscriptionPeriod.Unit) -> String {
        switch unit {
        case .day: return "day"
        case .week: return "week"
        case .month: return "month"
        case .year: return "year"
        @unknown default: return "unknown"
        }
    }

    @objc func getProducts(_ call: CAPPluginCall) {
        let ids = call.getArray("productIds", String.self) ?? []
        Task {
            do {
                let products = try await Product.products(for: ids)
                let list: [[String: Any]] = products.map { p in
                    var o: [String: Any] = [
                        "id": p.id,
                        "displayName": p.displayName,
                        "description": p.description,
                        "displayPrice": p.displayPrice,
                        "price": NSDecimalNumber(decimal: p.price).doubleValue
                    ]
                    if let s = p.subscription {
                        o["period"] = ["unit": StorePlugin.unitName(s.subscriptionPeriod.unit), "value": s.subscriptionPeriod.value]
                    }
                    return o
                }
                call.resolve(["products": list])
            } catch {
                call.reject(error.localizedDescription, "LOAD_FAILED")
            }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard let id = call.getString("productId") else {
            call.reject("productId is required", "INVALID")
            return
        }
        Task {
            do {
                guard let product = try await Product.products(for: [id]).first else {
                    call.reject("product not found", "NOT_FOUND")
                    return
                }
                let result = try await product.purchase()
                switch result {
                case .success(let verification):
                    switch verification {
                    case .verified(let transaction):
                        await transaction.finish()
                        call.resolve(["status": "purchased", "entitlements": await StorePlugin.currentEntitlements()])
                    case .unverified:
                        call.reject("purchase could not be verified", "UNVERIFIED")
                    }
                case .userCancelled:
                    call.resolve(["status": "cancelled"])
                case .pending:
                    // 保護者の承認待ちなど
                    call.resolve(["status": "pending"])
                @unknown default:
                    call.resolve(["status": "unknown"])
                }
            } catch {
                call.reject(error.localizedDescription, "FAILED")
            }
        }
    }

    @objc func getEntitlements(_ call: CAPPluginCall) {
        Task {
            call.resolve(["entitlements": await StorePlugin.currentEntitlements()])
        }
    }

    @objc func restore(_ call: CAPPluginCall) {
        Task {
            do {
                try await AppStore.sync()
                call.resolve(["entitlements": await StorePlugin.currentEntitlements()])
            } catch {
                call.reject(error.localizedDescription, "FAILED")
            }
        }
    }

    @objc func manageSubscriptions(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard let scene = self.bridge?.viewController?.view.window?.windowScene else {
                call.reject("window scene not available", "UNAVAILABLE")
                return
            }
            do {
                try await AppStore.showManageSubscriptions(in: scene)
                call.resolve()
            } catch {
                call.reject(error.localizedDescription, "FAILED")
            }
        }
    }
}
