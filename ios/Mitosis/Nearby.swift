import MultipeerConnectivity

/// Nearby play: phones running Mitosis find each other over Bluetooth and peer-to-peer Wi-Fi
/// (MultipeerConnectivity, no internet or shared network needed) and pass the page's presence
/// messages straight to each other, doing the job the server's relay does online.
///
/// Each phone's MCPeerID display name is the page's own room id, so every phone agrees on who is
/// who and the page's usual host election works unchanged. Phones connect automatically: of any
/// two that see each other, the one with the smaller id sends the invitation, and invitations are
/// always accepted (the player opted in by choosing Nearby).
final class Nearby: NSObject, MCSessionDelegate, MCNearbyServiceAdvertiserDelegate, MCNearbyServiceBrowserDelegate {
    static let shared = Nearby()
    static let service = "mitosis-play"           // must match NSBonjourServices in Info.plist
    private static let maxPeers = 7               // MultipeerConnectivity allows 8 phones in a session

    /// Events for the page: ["ev": "join" | "bye" | "p" | "error", "id": peer id, "data": presence JSON]
    var onEvent: (([String: Any]) -> Void)?

    private var me: MCPeerID?
    private var session: MCSession?
    private var advertiser: MCNearbyServiceAdvertiser?
    private var browser: MCNearbyServiceBrowser?
    private let queue = DispatchQueue(label: "mitosis.nearby")

    var isActive: Bool { session != nil }

    func start(id: String) {
        stop()
        let clean = String(id.filter { $0.isLetter || $0.isNumber }.prefix(32))
        let peer = MCPeerID(displayName: clean.isEmpty ? UUID().uuidString.prefix(12).lowercased() : clean)
        let s = MCSession(peer: peer, securityIdentity: nil, encryptionPreference: .optional)
        s.delegate = self
        me = peer
        session = s
        let a = MCNearbyServiceAdvertiser(peer: peer, discoveryInfo: nil, serviceType: Self.service)
        a.delegate = self
        a.startAdvertisingPeer()
        advertiser = a
        let b = MCNearbyServiceBrowser(peer: peer, serviceType: Self.service)
        b.delegate = self
        b.startBrowsingForPeers()
        browser = b
    }

    func stop() {
        advertiser?.stopAdvertisingPeer()
        browser?.stopBrowsingForPeers()
        session?.disconnect()
        advertiser = nil
        browser = nil
        session = nil
        me = nil
    }

    /// iOS drops the session when the app leaves the foreground; look for the others again on return.
    func resume() {
        guard let id = me?.displayName else { return }
        start(id: id)
    }

    /// One presence message to every connected phone. Unreliable like UDP: a newer one is never far behind.
    func send(_ text: String) {
        guard let s = session, !s.connectedPeers.isEmpty, let data = text.data(using: .utf8) else { return }
        queue.async { try? s.send(data, toPeers: s.connectedPeers, with: .unreliable) }
    }

    // MARK: - Finding each other

    func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID, withDiscoveryInfo info: [String: String]?) {
        guard let s = session, let me = me, peerID != me, me.displayName < peerID.displayName,
              s.connectedPeers.count < Self.maxPeers, !s.connectedPeers.contains(peerID) else { return }
        browser.invitePeer(peerID, to: s, withContext: nil, timeout: 15)
    }

    func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {}

    func browser(_ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: Error) {
        onEvent?(["ev": "error", "id": "", "text": "Could not look for phones nearby (\(error.localizedDescription)). Check Local Network in Settings → Mitosis."])
    }

    func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didReceiveInvitationFromPeer peerID: MCPeerID, withContext context: Data?, invitationHandler: @escaping (Bool, MCSession?) -> Void) {
        guard let s = session, s.connectedPeers.count < Self.maxPeers else { invitationHandler(false, nil); return }
        invitationHandler(true, s)
    }

    func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didNotStartAdvertisingPeer error: Error) {
        onEvent?(["ev": "error", "id": "", "text": "Could not be seen by phones nearby (\(error.localizedDescription))."])
    }

    // MARK: - Session

    func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        guard session === self.session else { return }
        switch state {
        case .connected: onEvent?(["ev": "join", "id": peerID.displayName])
        case .notConnected:
            onEvent?(["ev": "bye", "id": peerID.displayName])
            // the browser reports a phone only once, so look again in case it is still around and can rejoin
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
                guard let b = self?.browser else { return }
                b.stopBrowsingForPeers()
                b.startBrowsingForPeers()
            }
        default: break
        }
    }

    func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        guard session === self.session, data.count < 64_000, let text = String(data: data, encoding: .utf8) else { return }
        onEvent?(["ev": "p", "id": peerID.displayName, "data": text])
    }

    func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {}
    func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {}
    func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {}
}
