// Cut a subject out of a photo with macOS Vision (the "Remove Background" engine), add a white sticker outline,
// crop and save as PNG.
// usage: cutout <in.jpg> <out.png|out.avif> <instances: all | list | 1,2> <outlinePx> <scale> [erodePx]
import Foundation
import Vision
import CoreImage
import CoreImage.CIFilterBuiltins

let a = CommandLine.arguments
let inURL = URL(fileURLWithPath: a[1]), outURL = URL(fileURLWithPath: a[2])
let which = a[3], outline = Double(a[4]) ?? 0, scale = Double(a[5]) ?? 1, erode = a.count > 6 ? Double(a[6]) ?? 0 : 0

let handler = VNImageRequestHandler(url: inURL)
let req = VNGenerateForegroundInstanceMaskRequest()
try handler.perform([req])
guard let obs = req.results?.first else { print("no subject found"); exit(1) }

func up(_ i: CIImage) -> CIImage {
    scale == 1 ? i : i.applyingFilter("CILanczosScaleTransform", parameters: [kCIInputScaleKey: scale, kCIInputAspectRatioKey: 1.0])
}
let src = up(CIImage(contentsOf: inURL)!)
if which == "list" {
    // print every instance's bounding box (0..1, origin top-left) so one can be chosen
    let mask = CIImage(cvPixelBuffer: obs.instanceMask)
    let w = mask.extent.width, h = mask.extent.height
    let ctx = CIContext()
    var buf = [UInt8](repeating: 0, count: Int(w * h))
    ctx.render(mask, toBitmap: &buf, rowBytes: Int(w), bounds: mask.extent, format: .L8, colorSpace: nil)
    for inst in obs.allInstances.sorted() {
        var minX = Int.max, minY = Int.max, maxX = -1, maxY = -1, n = 0
        for y in 0..<Int(h) { for x in 0..<Int(w) where Int(buf[y * Int(w) + x]) == inst {
            n += 1; minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y) } }
        print("instance \(inst): pixels \(n) box x \(Double(minX)/w)-\(Double(maxX)/w) y \(Double(minY)/h)-\(Double(maxY)/h)")
    }
    exit(0)
}
let set: IndexSet = which == "all" ? obs.allInstances : IndexSet(which.split(separator: ",").compactMap { Int($0) })
let maskBuf = try obs.generateScaledMaskForImage(forInstances: set, from: handler)
var mask = up(CIImage(cvPixelBuffer: maskBuf)).cropped(to: src.extent)
if erode > 0 { mask = mask.applyingFilter("CIMorphologyMinimum", parameters: [kCIInputRadiusKey: erode]).cropped(to: src.extent) }

// Cat on transparent ground
let clear = CIImage(color: .clear).cropped(to: src.extent)
var cat = src.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: clear, kCIInputMaskImageKey: mask])

if outline > 0 {
    // grow the mask, fill it white, put the cat on top: a sticker edge
    let grown = mask.applyingFilter("CIMorphologyMaximum", parameters: [kCIInputRadiusKey: outline])
        .applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: 1.2]).cropped(to: src.extent)
    let white = CIImage(color: .white).cropped(to: src.extent)
    let edge = white.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: clear, kCIInputMaskImageKey: grown])
    cat = cat.composited(over: edge)
    mask = grown
}

// crop to the visible pixels
let ctx = CIContext()
let w = Int(mask.extent.width), h = Int(mask.extent.height)
var buf = [UInt8](repeating: 0, count: w * h)
ctx.render(mask, toBitmap: &buf, rowBytes: w, bounds: mask.extent, format: .L8, colorSpace: nil)
var minX = w, minY = h, maxX = 0, maxY = 0
for y in 0..<h { for x in 0..<w where buf[y * w + x] > 8 { minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y) } }
// bitmap rows run top to bottom; CI coordinates run bottom to top
let crop = CGRect(x: CGFloat(minX), y: CGFloat(h - 1 - maxY), width: CGFloat(maxX - minX + 1), height: CGFloat(maxY - minY + 1))
var out = cat.cropped(to: crop).transformed(by: CGAffineTransform(translationX: -crop.minX, y: -crop.minY))
let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
if outURL.pathExtension == "avif" {
    let cg = ctx.createCGImage(out, from: out.extent, format: .RGBA8, colorSpace: srgb)!
    let dst = CGImageDestinationCreateWithURL(outURL as CFURL, "public.avif" as CFString, 1, nil)!
    CGImageDestinationAddImage(dst, cg, [kCGImageDestinationLossyCompressionQuality: 0.72] as CFDictionary)
    guard CGImageDestinationFinalize(dst) else { print("avif write failed"); exit(1) }
} else {
    try ctx.writePNGRepresentation(of: out, to: outURL, format: .RGBA8, colorSpace: srgb)
}
print("wrote \(outURL.lastPathComponent) \(Int(out.extent.width))x\(Int(out.extent.height)) crop y \(minY)-\(maxY) of \(h), x \(minX)-\(maxX) of \(w)")
