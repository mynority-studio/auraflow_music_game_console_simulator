// macOS-only, dependency-free MIDI → WAV renderer.
// Usage:
// swift scripts/render-midi-to-wav.swift --midi score.mid --sf2 "Full Grand Piano.sf2" --out score.wav [--tail 2]

import AVFoundation
import AudioToolbox
import Foundation

enum RenderError: Error, LocalizedError {
  case usage
  case invalidValue(String)
  case offlineRenderFailed

  var errorDescription: String? {
    switch self {
    case .usage: return "Usage: render-midi-to-wav.swift --midi <file.mid> --sf2 <file.sf2> --out <file.wav> [--tail <seconds>]"
    case .invalidValue(let value): return "Invalid value: \(value)"
    case .offlineRenderFailed: return "AVAudioEngine offline rendering failed"
    }
  }
}

struct Options {
  let midi: URL
  let soundFont: URL
  let output: URL
  let tailSeconds: Double
}

func readOptions() throws -> Options {
  var values: [String: String] = [:]
  var index = 1
  while index < CommandLine.arguments.count {
    let key = CommandLine.arguments[index]
    guard key.hasPrefix("--"), index + 1 < CommandLine.arguments.count else { throw RenderError.usage }
    values[key] = CommandLine.arguments[index + 1]
    index += 2
  }
  guard let midi = values["--midi"], let sf2 = values["--sf2"], let output = values["--out"] else { throw RenderError.usage }
  let tail = values["--tail"].flatMap(Double.init) ?? 2.0
  guard tail >= 0 else { throw RenderError.invalidValue("--tail") }
  return Options(midi: URL(fileURLWithPath: midi), soundFont: URL(fileURLWithPath: sf2), output: URL(fileURLWithPath: output), tailSeconds: tail)
}

func render(_ options: Options) throws {
  let sampleRate = 44_100.0
  let maxFrames: AVAudioFrameCount = 4_096
  let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2)!
  let engine = AVAudioEngine()
  let sampler = AVAudioUnitSampler()
  engine.attach(sampler)
  engine.connect(sampler, to: engine.mainMixerNode, format: format)
  try sampler.loadSoundBankInstrument(
    at: options.soundFont,
    program: 0,
    bankMSB: UInt8(kAUSampler_DefaultMelodicBankMSB),
    bankLSB: UInt8(kAUSampler_DefaultBankLSB)
  )

  let sequencer = AVAudioSequencer(audioEngine: engine)
  try sequencer.load(from: Data(contentsOf: options.midi), options: [])
  for track in sequencer.tracks { track.destinationAudioUnit = sampler }

  try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: maxFrames)
  engine.prepare()
  try engine.start()
  try sequencer.prepareToPlay()
  try sequencer.start()

  let longestTrack = sequencer.tracks.map(\.lengthInSeconds).max() ?? 0
  let targetFrames = Int((longestTrack + options.tailSeconds) * sampleRate)
  let buffer = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: maxFrames)!
  let output = try AVAudioFile(forWriting: options.output, settings: format.settings, commonFormat: .pcmFormatFloat32, interleaved: false)
  var renderedFrames = 0
  while renderedFrames < targetFrames {
    let requested = AVAudioFrameCount(min(Int(maxFrames), targetFrames - renderedFrames))
    switch try engine.renderOffline(requested, to: buffer) {
    case .success:
      try output.write(from: buffer)
      renderedFrames += Int(buffer.frameLength)
    case .cannotDoInCurrentContext:
      continue
    case .insufficientDataFromInputNode:
      continue
    case .error:
      throw RenderError.offlineRenderFailed
    @unknown default:
      throw RenderError.offlineRenderFailed
    }
  }
  sequencer.stop()
  engine.stop()
  print("WAV: \(options.output.path) (\(String(format: "%.2f", Double(renderedFrames) / sampleRate))s)")
}

do {
  try render(readOptions())
} catch {
  FileHandle.standardError.write(Data("error: \(error.localizedDescription)\n".utf8))
  exit(1)
}
