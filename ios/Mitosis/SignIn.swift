import Foundation
import AuthenticationServices
import CryptoKit
import Security
import UIKit

/// Sign in with Apple (native) and Sign in with Google (OAuth in the system browser sheet,
/// no SDK) for the game. Each hands back the credential the page sends to the server, which
/// verifies the token and links the player's wallet to that account.
final class SignIn: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding, ASWebAuthenticationPresentationContextProviding {
    static let shared = SignIn()

    enum Failure: LocalizedError {
        case cancelled, noToken, notConfigured(String), google(String)
        var errorDescription: String? {
            switch self {
            case .cancelled: return "cancelled"
            case .noToken: return "Apple did not return an identity token"
            case .notConfigured(let p): return "\(p) sign-in is not set up in this build"
            case .google(let m): return m
            }
        }
    }

    /// Google's iOS OAuth client id (Info.plist GoogleClientID, from GOOGLE_IOS_CLIENT_ID in project.yml). Empty: no Google button.
    private let googleClientId = (Bundle.main.object(forInfoDictionaryKey: "GoogleClientID") as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    var providers: [String] { googleClientId.isEmpty ? ["apple"] : ["apple", "google"] }

    private var appleContinuation: CheckedContinuation<[String: Any], Error>?
    private var webSession: ASWebAuthenticationSession?

    @MainActor
    func signIn(provider: String, nonce: String) async throws -> [String: Any] {
        switch provider {
        case "apple": return try await apple(nonce: nonce)
        case "google": return try await google(nonce: nonce)
        default: throw Failure.notConfigured(provider)
        }
    }

    // MARK: - Apple

    @MainActor
    private func apple(nonce: String) async throws -> [String: Any] {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined()   // the server checks sha256(nonce)
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        return try await withCheckedThrowingContinuation { cont in
            appleContinuation = cont
            controller.performRequests()
        }
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let c = authorization.credential as? ASAuthorizationAppleIDCredential, let data = c.identityToken, let token = String(data: data, encoding: .utf8) else {
            appleContinuation?.resume(throwing: Failure.noToken); appleContinuation = nil; return
        }
        let name = [c.fullName?.givenName, c.fullName?.familyName].compactMap { $0 }.joined(separator: " ")
        appleContinuation?.resume(returning: ["identityToken": token, "name": name, "email": c.email ?? ""])
        appleContinuation = nil
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        let cancelled = (error as? ASAuthorizationError)?.code == .canceled
        appleContinuation?.resume(throwing: cancelled ? Failure.cancelled : error)
        appleContinuation = nil
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor { Self.window }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { Self.window }
    private static var window: UIWindow {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first { $0.isKeyWindow } ?? UIWindow()
    }

    // MARK: - Google: OpenID Connect authorization-code flow with PKCE, then the code is exchanged for an ID token

    @MainActor
    private func google(nonce: String) async throws -> [String: Any] {
        guard !googleClientId.isEmpty else { throw Failure.notConfigured("Google") }
        // The redirect scheme of an iOS client is its id reversed: 1234-abc.apps.googleusercontent.com → com.googleusercontent.apps.1234-abc
        let scheme = googleClientId.components(separatedBy: ".").reversed().joined(separator: ".")
        let redirect = scheme + ":/oauth2redirect"
        let verifier = Self.random(32), state = Self.random(16)
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL()
        var comps = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        comps.queryItems = [
            URLQueryItem(name: "client_id", value: googleClientId), URLQueryItem(name: "redirect_uri", value: redirect),
            URLQueryItem(name: "response_type", value: "code"), URLQueryItem(name: "scope", value: "openid email profile"),
            URLQueryItem(name: "code_challenge", value: challenge), URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "nonce", value: nonce), URLQueryItem(name: "state", value: state),
        ]
        let callback: URL = try await withCheckedThrowingContinuation { cont in
            let session = ASWebAuthenticationSession(url: comps.url!, callbackURLScheme: scheme) { url, error in
                if let url { cont.resume(returning: url) }
                else if let e = error as? ASWebAuthenticationSessionError, e.code == .canceledLogin { cont.resume(throwing: Failure.cancelled) }
                else { cont.resume(throwing: error ?? Failure.google("Google sign-in failed")) }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            webSession = session
            session.start()
        }
        let query = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard query.first(where: { $0.name == "state" })?.value == state, let code = query.first(where: { $0.name == "code" })?.value else {
            throw Failure.google("Google sign-in returned no code")
        }
        var req = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody = Self.form(["code": code, "client_id": googleClientId, "redirect_uri": redirect, "grant_type": "authorization_code", "code_verifier": verifier])
        let (data, _) = try await URLSession.shared.data(for: req)
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard let idToken = json["id_token"] as? String else { throw Failure.google(json["error_description"] as? String ?? "Google did not return an ID token") }
        return ["idToken": idToken]
    }

    private static func random(_ n: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: n)
        _ = SecRandomCopyBytes(kSecRandomDefault, n, &bytes)
        return Data(bytes).base64URL()
    }

    private static func form(_ fields: [String: String]) -> Data {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return fields.map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")" }.joined(separator: "&").data(using: .utf8)!
    }
}

private extension Data {
    func base64URL() -> String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
