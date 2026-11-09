import Foundation
import StoreKit

/// StoreKit 2 wrapper for the ATP packs. The server (economy.js) is the source of
/// truth: a purchase only becomes ATP once the game has sent the signed transaction
/// to /api/iap/apple and the server credited it. Only then is the transaction
/// finished; anything unfinished is handed to the game again every time it is ready.
///
/// Every paid-but-unfinished transaction is kept in `open` until the game finishes it.
/// Transaction.updates starts at launch, long before the page has reached the server
/// and said "ready", so a purchase that arrives in between (a charge whose redeem
/// failed last time, Ask to Buy, a purchase on another device) waits here instead of
/// being dropped, and `pageReady` hands it over.
@MainActor
final class Store {
    static let shared = Store()

    /// Called for purchases that arrive outside a `buy` call. Nil until the page is ready.
    private var onPurchase: (([String: Any]) -> Void)?

    private var products: [String: Product] = [:]
    private var updates: Task<Void, Never>?
    private var open: [String: (transaction: Transaction, purchase: [String: Any])] = [:]

    func start() {
        updates = Task.detached { [weak self] in
            for await result in Transaction.updates {
                guard case .verified(let t) = result else { continue }
                await self?.arrived(t, jws: result.jwsRepresentation)
            }
        }
    }

    /// The page reached the server and can redeem purchases: hand it every transaction
    /// that is paid but not finished, then keep handing it new ones as they arrive.
    func pageReady(_ handler: @escaping ([String: Any]) -> Void) async {
        onPurchase = handler
        var sent = Set<String>()
        for (id, entry) in open { sent.insert(id); handler(entry.purchase) }
        for await result in Transaction.unfinished {
            guard case .verified(let t) = result else { continue }
            let id = String(t.id)
            if open[id] == nil { open[id] = (t, Self.purchaseDict(t, jws: result.jwsRepresentation)) }
            if sent.insert(id).inserted, let entry = open[id] { handler(entry.purchase) }
        }
    }

    private func arrived(_ t: Transaction, jws: String) {
        let id = String(t.id)
        guard open[id] == nil else { return } // already handed over (the reply to `buy`, or an earlier update)
        let purchase = Self.purchaseDict(t, jws: jws)
        open[id] = (t, purchase)
        onPurchase?(purchase)
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
            case .verified(let t):
                let purchase = Self.purchaseDict(t, jws: verification.jwsRepresentation)
                open[String(t.id)] = (t, purchase)
                return purchase
            case .unverified(_, let error): throw error
            }
        case .userCancelled, .pending: return nil
        @unknown default: return nil
        }
    }

    /// The server credited it: finish the transaction so StoreKit stops re-delivering it.
    func finish(transactionId: String) async {
        if let entry = open.removeValue(forKey: transactionId) { await entry.transaction.finish(); return }
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
