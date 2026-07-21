#!/usr/bin/env swift

// Read-only hand-pose oracle for piano-frame curation.
// Usage: swift scripts/audit-piano-hand-pose.swift frame1.png [frame2.png ...]

import CoreGraphics
import Foundation
import ImageIO
import Vision

struct PointRecord: Codable {
  let name: String
  let x: Double
  let y: Double
  let confidence: Float
}

struct HandRecord: Codable {
  let chirality: String
  let confidence: Float
  let points: [PointRecord]
}

struct FrameRecord: Codable {
  let path: String
  let width: Int
  let height: Int
  let hands: [HandRecord]
}

let pointNames: [(VNHumanHandPoseObservation.JointName, String)] = [
  (.wrist, "wrist"),
  (.thumbTip, "thumbTip"),
  (.indexTip, "indexTip"),
  (.middleTip, "middleTip"),
  (.ringTip, "ringTip"),
  (.littleTip, "littleTip"),
]

guard CommandLine.arguments.count >= 2 else {
  fputs("usage: audit-piano-hand-pose.swift frame1.png [frame2.png ...]\n", stderr)
  exit(2)
}

var records: [FrameRecord] = []
for path in CommandLine.arguments.dropFirst() {
  let url = URL(fileURLWithPath: path)
  guard
    let source = CGImageSourceCreateWithURL(url as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
  else {
    throw NSError(domain: "hand-pose-audit", code: 1, userInfo: [NSLocalizedDescriptionKey: "cannot read \(path)"])
  }

  let request = VNDetectHumanHandPoseRequest()
  request.maximumHandCount = 2
  let handler = VNImageRequestHandler(cgImage: image, options: [:])
  try handler.perform([request])

  let hands = try (request.results ?? []).map { observation -> HandRecord in
    let recognized = try observation.recognizedPoints(.all)
    let points = pointNames.compactMap { joint, name -> PointRecord? in
      guard let point = recognized[joint], point.confidence >= 0.15 else { return nil }
      return PointRecord(
        name: name,
        x: Double(point.location.x) * Double(image.width),
        // Vision's origin is bottom-left; image/contact-sheet coordinates use top-left.
        y: (1.0 - Double(point.location.y)) * Double(image.height),
        confidence: point.confidence
      )
    }
    let chirality: String
    switch observation.chirality {
    case .left: chirality = "left"
    case .right: chirality = "right"
    default: chirality = "unknown"
    }
    return HandRecord(chirality: chirality, confidence: observation.confidence, points: points)
  }
  records.append(FrameRecord(path: path, width: image.width, height: image.height, hands: hands))
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
FileHandle.standardOutput.write(try encoder.encode(records))
FileHandle.standardOutput.write(Data("\n".utf8))
