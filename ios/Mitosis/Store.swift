import Foundation
import StoreKit

/// StoreKit 2 wrapper for the ATP packs. The server (economy.js) is the source of
/// truth: a purchase only becomes ATP once the game has sent the signed transaction
/// to /api/iap/apple and the server credited it. Only then is the transaction
/// finished; anything unfinished is re-delivered on the next launch.
final class Store {
    static let shared = Store()

    /// Called for purchases that arrive outside a `buy` call (restored / unfinished / family).
    var onPurchase: (([String: Any]) -> Void)?

    private var products: [String: Product] = [:]
    private var updates: Task<Void, Never>?

    func start() {
        updates = Task.detached { [weak self] in
            for await result in Transaction.updates {
                guard let self, case .verified(let t) = result else { continue }
                self.onPurchase?(Self.purchaseDict(t, jws: result.jwsRepresentation))
            }
        }
    }

    func deliverUnfinished() async {
        for await result in Transaction.unfinished {
            guard case .verified(let t) = result else { continue }
            onPurchase?(Self.purchaseDict(t, jws: result.jwsRepresentation))
        }
    }

    func products(ids: [String]) async throws -> [[String: Any]] {
        let found = try await Product.products(for: ids)
        for p in found { products[p.id] = p }
        return found.sorted { $0.price < $1.price }.map {
            ["id": $0.id, "price": $0.displayPrice, "title": $0.displayName, "description": $0.description]
        }
    }

    /// Returns the purchase for the game to redeem, or nil when cancelled / still pending.
    func buy(id: String) async throws -> [String: Any]? {
        let product: Product
        if let p = products[id] { product = p }
        else if let p = try await Product.products(for: [id]).first { products[id] = p; product = p }
        else { throw StoreError.unknownProduct(id) }

        let result = try await product.purchase()
        switch result {
        case .success(let verification):
            switch verification {
            case .verified(let t): return Self.purchaseDict(t, jws: verification.jwsRepresentation)
            case .unverified(_, let error): throw error
            }
        case .userCancelled, .pending: return nil
        @unknown default: return nil
        }
    }

    func finish(transactionId: String) async {
        for await result in Transaction.unfinished {
            if case .verified(let t) = result, String(t.id) == transactionId { await t.finish() }
        }
    }

    private static func purchaseDict(_ t: Transaction, jws: String) -> [String: Any] {
        ["platform": "ios", "productId": t.productID, "transactionId": String(t.id), "jws": jws]
    }

    enum StoreError: LocalizedError {
        case unknownProduct(String)
        var errorDescription: String? {
            switch self { case .unknownProduct(let id): return "Product \(id) is not available in the App Store yet" }
        }
    }
}
