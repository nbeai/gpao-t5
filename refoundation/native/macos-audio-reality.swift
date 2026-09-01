import AudioToolbox
import AVFoundation
import CoreMedia
import Foundation

private struct ContainerReceipt: Codable {
    let identifier: String?
    let evidence: String
}

private struct TrackReceipt: Codable {
    let index: Int
    let trackId: Int32
    let kind: String
    let codec: String?
    let sampleRate: Double?
    let channels: Int?
    let languageTag: String?
}

private struct AudioRealityReceipt: Codable {
    let schema: String
    let container: ContainerReceipt
    let durationMs: Double
    let tracks: [TrackReceipt]
    let audioTrackCount: Int
    let videoTrackCount: Int
    let coverage: String
}

private func fourCC(_ value: UInt32) -> String {
    let bytes: [UInt8] = [
        UInt8((value >> 24) & 0xff), UInt8((value >> 16) & 0xff),
        UInt8((value >> 8) & 0xff), UInt8(value & 0xff),
    ]
    if bytes.allSatisfy({ $0 >= 0x20 && $0 <= 0x7e }) {
        return String(bytes: bytes, encoding: .ascii) ?? String(format: "0x%08x", value)
    }
    return String(format: "0x%08x", value)
}

private struct NativeAudioFileFacts {
    let container: ContainerReceipt
    let durationMs: Double
    let track: TrackReceipt
}

private func nativeAudioFileFacts(_ url: URL) -> NativeAudioFileFacts? {
    var extended: ExtAudioFileRef?
    guard ExtAudioFileOpenURL(url as CFURL, &extended) == noErr, let extended else {
        fputs("audio reality note: extended audio open unavailable\n", stderr); return nil
    }
    defer { ExtAudioFileDispose(extended) }
    var format = AudioStreamBasicDescription()
    var formatSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
    guard ExtAudioFileGetProperty(extended, kExtAudioFileProperty_FileDataFormat,
                                  &formatSize, &format) == noErr,
          format.mSampleRate.isFinite, format.mSampleRate > 0 else {
        fputs("audio reality note: data format unavailable\n", stderr); return nil
    }
    var frameCount: Int64 = 0
    var frameCountSize = UInt32(MemoryLayout<Int64>.size)
    guard ExtAudioFileGetProperty(extended, kExtAudioFileProperty_FileLengthFrames,
                                  &frameCountSize, &frameCount) == noErr, frameCount >= 0 else {
        fputs("audio reality note: frame count unavailable\n", stderr); return nil
    }
    var identifier: AudioFileTypeID = 0
    var container = ContainerReceipt(identifier: nil, evidence: "unavailable")
    var audioFile: AudioFileID?
    var audioFileSize = UInt32(MemoryLayout<AudioFileID?>.size)
    if ExtAudioFileGetProperty(extended, kExtAudioFileProperty_AudioFile,
                               &audioFileSize, &audioFile) == noErr, let audioFile {
        var identifierSize = UInt32(MemoryLayout<AudioFileTypeID>.size)
        if AudioFileGetProperty(audioFile, kAudioFilePropertyFileFormat,
                                &identifierSize, &identifier) == noErr {
            container = ContainerReceipt(identifier: fourCC(identifier), evidence: "audio_file_property")
        }
    }
    let duration = Double(frameCount) / format.mSampleRate
    return NativeAudioFileFacts(
        container: container,
        durationMs: duration * 1000,
        track: TrackReceipt(index: 0, trackId: 1, kind: "audio", codec: fourCC(format.mFormatID),
                            sampleRate: format.mSampleRate, channels: Int(format.mChannelsPerFrame),
                            languageTag: nil)
    )
}

private func trackReceipt(_ track: AVAssetTrack, index: Int) async -> TrackReceipt {
    let mediaType = track.mediaType
    let kind = mediaType == .audio ? "audio" : mediaType == .video ? "video" : "other"
    let descriptions = (try? await track.load(.formatDescriptions)) ?? []
    let first = descriptions.first
    let codec = first.map { fourCC(CMFormatDescriptionGetMediaSubType($0)) }
    var sampleRate: Double? = nil
    var channels: Int? = nil
    if let first, mediaType == .audio,
       let basic = CMAudioFormatDescriptionGetStreamBasicDescription(first) {
        sampleRate = basic.pointee.mSampleRate
        channels = Int(basic.pointee.mChannelsPerFrame)
    }
    let extendedLanguageTag = try? await track.load(.extendedLanguageTag)
    let languageCode = try? await track.load(.languageCode)
    let languageTag = extendedLanguageTag ?? languageCode
    return TrackReceipt(index: index, trackId: track.trackID, kind: kind, codec: codec,
                        sampleRate: sampleRate, channels: channels, languageTag: languageTag)
}

@main
private struct AudioRealityMain {
    static func main() async {
        let arguments = CommandLine.arguments
        guard arguments.count == 3, arguments[1] == "--inspect" else {
            fputs("audio reality usage: --inspect FILE\n", stderr)
            exit(64)
        }
        let url = URL(fileURLWithPath: arguments[2]).standardizedFileURL
        if let native = nativeAudioFileFacts(url) {
            let receipt = AudioRealityReceipt(
                schema: "t5.audio-reality.v1", container: native.container,
                durationMs: native.durationMs, tracks: [native.track],
                audioTrackCount: 1, videoTrackCount: 0, coverage: "complete"
            )
            do {
                let output = try JSONEncoder().encode(receipt)
                FileHandle.standardOutput.write(output); FileHandle.standardOutput.write(Data([0x0a]))
                return
            } catch { fputs("audio reality failed: receipt encoding\n", stderr); exit(68) }
        }
        let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
        do {
            let duration: CMTime
            do { duration = try await asset.load(.duration) }
            catch { fputs("audio reality failed: duration unavailable\n", stderr); exit(66) }
            let seconds = CMTimeGetSeconds(duration)
            guard seconds.isFinite, seconds >= 0 else {
                fputs("audio reality failed: invalid duration\n", stderr)
                exit(65)
            }
            let tracks: [AVAssetTrack]
            do { tracks = try await asset.load(.tracks) }
            catch { fputs("audio reality failed: tracks unavailable\n", stderr); exit(67) }
            var receipts: [TrackReceipt] = []
            for (index, track) in tracks.enumerated() {
                receipts.append(await trackReceipt(track, index: index))
            }
            let receipt = AudioRealityReceipt(
                schema: "t5.audio-reality.v1",
                container: ContainerReceipt(identifier: nil, evidence: "unavailable"),
                durationMs: seconds * 1000, tracks: receipts,
                audioTrackCount: receipts.filter { $0.kind == "audio" }.count,
                videoTrackCount: receipts.filter { $0.kind == "video" }.count,
                coverage: "complete"
            )
            let output = try JSONEncoder().encode(receipt)
            FileHandle.standardOutput.write(output)
            FileHandle.standardOutput.write(Data([0x0a]))
        } catch {
            fputs("audio reality failed: receipt encoding\n", stderr)
            exit(68)
        }
    }
}
