import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.backgroundColor = GameViewController.voidColor
        window.rootViewController = GameViewController()
        window.makeKeyAndVisible()
        self.window = window
        Store.shared.start()
        return true
    }
}
