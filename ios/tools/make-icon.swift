// Draws the 1024×1024 app icon (a pink cell in a dark petri well) with CoreGraphics.
// Run:  swift ios/tools/make-icon.swift ios/Mitosis/Assets.xcassets/AppIcon.appiconset/icon-1024.png
import AppKit

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon-1024.png"
let S = 1024
let cs = CGColorSpaceCreateDeviceRGB()
// RGB without alpha: App Store icons must be opaque.
let ctx = CGContext(data: nil, width: S, height: S, bitsPerComponent: 8, bytesPerRow: 0, space: cs, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
func rgb(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> CGColor { CGColor(colorSpace: cs, components: [r / 255, g / 255, b / 255, a])! }
func radial(_ colors: [CGColor], _ locs: [CGFloat], center: CGPoint, r0: CGFloat, r1: CGFloat, edge: CGPoint? = nil) {
    let g = CGGradient(colorsSpace: cs, colors: colors as CFArray, locations: locs)!
    ctx.drawRadialGradient(g, startCenter: center, startRadius: r0, endCenter: edge ?? center, endRadius: r1, options: [.drawsAfterEndLocation])
}
func circle(_ k: CGPoint, _ r: CGFloat) -> CGRect { CGRect(x: k.x - r, y: k.y - r, width: r * 2, height: r * 2) }
let c = CGPoint(x: 512, y: 512)

// Petri well: dark teal vignette
ctx.setFillColor(rgb(2, 8, 9)); ctx.fill(CGRect(x: 0, y: 0, width: S, height: S))
radial([rgb(12, 44, 46), rgb(5, 20, 22), rgb(2, 8, 9)], [0, 0.6, 1], center: CGPoint(x: 470, y: 560), r0: 0, r1: 760)
// Faint rim
ctx.setStrokeColor(rgb(140, 210, 200, 0.12)); ctx.setLineWidth(14)
ctx.strokeEllipse(in: CGRect(x: 72, y: 72, width: 880, height: 880))
// Nutrient pellets
srand48(7)
for _ in 0..<70 {
    let a = drand48() * .pi * 2, d = 300 + drand48() * 180
    let p = CGPoint(x: c.x + cos(a) * d, y: c.y + sin(a) * d), r = 5 + drand48() * 7
    ctx.setFillColor(drand48() < 0.5 ? rgb(95, 224, 168, 0.75) : rgb(154, 140, 255, 0.7))
    ctx.fillEllipse(in: circle(p, r))
}
func cell(_ k: CGPoint, _ r: CGFloat, hi: CGColor, mid: CGColor, lo: CGColor, edge: CGColor) {
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -r * 0.12), blur: r * 0.5, color: rgb(0, 0, 0, 0.55))
    ctx.setFillColor(mid); ctx.fillEllipse(in: circle(k, r))
    ctx.restoreGState()
    ctx.saveGState(); ctx.addEllipse(in: circle(k, r)); ctx.clip()
    radial([hi, mid, lo], [0, 0.62, 1], center: CGPoint(x: k.x - r * 0.35, y: k.y + r * 0.4), r0: r * 0.05, r1: r * 1.05, edge: k)
    ctx.restoreGState()
    ctx.setStrokeColor(edge); ctx.setLineWidth(r * 0.085); ctx.strokeEllipse(in: circle(k, r))
    ctx.setStrokeColor(rgb(255, 255, 255, 0.18)); ctx.setLineWidth(r * 0.018); ctx.strokeEllipse(in: circle(k, r * 0.9))
}
// Small teal cell, tucked behind
cell(CGPoint(x: 760, y: 300), 120, hi: rgb(120, 230, 215), mid: rgb(60, 190, 175), lo: rgb(30, 140, 130), edge: rgb(18, 95, 90))
// Hero pink cell
let R: CGFloat = 330
cell(c, R, hi: rgb(255, 170, 196), mid: rgb(255, 92, 138), lo: rgb(214, 40, 95), edge: rgb(150, 20, 70))
// Organelles
let org: [(CGFloat, CGFloat, CGFloat, Bool)] = [(0.4, 0.5, 0.075, true), (2.1, 0.58, 0.06, false), (3.4, 0.46, 0.09, true), (4.6, 0.6, 0.055, false), (5.5, 0.38, 0.07, true), (1.3, 0.62, 0.05, false)]
for (a, d, s, light) in org {
    let p = CGPoint(x: c.x + cos(a) * d * R, y: c.y + sin(a) * d * R)
    ctx.setFillColor(light ? rgb(255, 200, 220, 0.4) : rgb(170, 20, 80, 0.4))
    ctx.fillEllipse(in: circle(p, s * R))
}
// Nucleus, trailing slightly
let n = CGPoint(x: c.x - R * 0.1, y: c.y - R * 0.06), nr = R * 0.3
ctx.saveGState(); ctx.addEllipse(in: circle(n, nr)); ctx.clip()
radial([rgb(240, 90, 140), rgb(170, 30, 85)], [0, 1], center: CGPoint(x: n.x - nr * 0.3, y: n.y + nr * 0.3), r0: 0, r1: nr * 1.1, edge: n)
ctx.restoreGState()
ctx.setStrokeColor(rgb(120, 10, 55, 0.5)); ctx.setLineWidth(4); ctx.strokeEllipse(in: circle(n, nr))
ctx.setFillColor(rgb(110, 8, 50, 0.6))
ctx.fillEllipse(in: circle(CGPoint(x: n.x + nr * 0.25, y: n.y - nr * 0.2), nr * 0.3))
// Highlight
ctx.saveGState(); ctx.translateBy(x: c.x - R * 0.36, y: c.y + R * 0.42); ctx.rotate(by: 0.72)
ctx.setFillColor(rgb(255, 255, 255, 0.2)); ctx.fillEllipse(in: CGRect(x: -R * 0.22, y: -R * 0.09, width: R * 0.44, height: R * 0.18))
ctx.restoreGState()

let image = ctx.makeImage()!
let rep = NSBitmapImageRep(cgImage: image)
let png = rep.representation(using: .png, properties: [:])!
try! png.write(to: URL(fileURLWithPath: out))
print("wrote \(out) \(image.width)x\(image.height)")
