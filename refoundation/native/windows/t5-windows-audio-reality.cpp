#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mfapi.h>
#include <mferror.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <propvarutil.h>
#include <wrl/client.h>

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <cwchar>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

using Microsoft::WRL::ComPtr;

struct Track {
    DWORD index;
    DWORD trackId;
    std::string kind;
    std::string codec;
    UINT32 sampleRate;
    UINT32 channels;
    std::string language;
};

static std::string utf8(const wchar_t* value) {
    if (value == nullptr) return {};
    const int length = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value, -1, nullptr, 0, nullptr, nullptr);
    if (length <= 1) return {};
    std::string output(static_cast<size_t>(length), '\0');
    WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value, -1, output.data(), length, nullptr, nullptr);
    output.pop_back();
    return output;
}

static std::string json(const std::string& value) {
    std::ostringstream output;
    for (const unsigned char character : value) {
        switch (character) {
        case '"': output << "\\\""; break;
        case '\\': output << "\\\\"; break;
        case '\b': output << "\\b"; break;
        case '\f': output << "\\f"; break;
        case '\n': output << "\\n"; break;
        case '\r': output << "\\r"; break;
        case '\t': output << "\\t"; break;
        default:
            if (character < 0x20) {
                output << "\\u" << std::hex << std::setw(4) << std::setfill('0')
                       << static_cast<unsigned int>(character) << std::dec;
            } else output << character;
        }
    }
    return output.str();
}

static std::string codecIdentifier(const GUID& subtype) {
    const uint32_t value = subtype.Data1;
    const unsigned char bytes[4] = {
        static_cast<unsigned char>(value & 0xff),
        static_cast<unsigned char>((value >> 8) & 0xff),
        static_cast<unsigned char>((value >> 16) & 0xff),
        static_cast<unsigned char>((value >> 24) & 0xff),
    };
    bool printable = true;
    for (const unsigned char byte : bytes) if (byte < 0x20 || byte > 0x7e) printable = false;
    if (printable) return std::string(reinterpret_cast<const char*>(bytes), 4);
    std::ostringstream output;
    output << "0x" << std::hex << std::setw(8) << std::setfill('0') << value;
    return output.str();
}

static std::string languageFor(IMFSourceReader* reader, DWORD index) {
    PROPVARIANT value;
    PropVariantInit(&value);
    const HRESULT status = reader->GetPresentationAttribute(index, MF_SD_LANGUAGE, &value);
    std::string language;
    if (SUCCEEDED(status) && value.vt == VT_LPWSTR) language = utf8(value.pwszVal);
    PropVariantClear(&value);
    return language;
}

static int fail(const char* message, int code) {
    std::cerr << "audio reality failed: " << message << "\n";
    return code;
}

static void put16(unsigned char* destination, uint16_t value) {
    destination[0] = static_cast<unsigned char>(value & 0xff);
    destination[1] = static_cast<unsigned char>((value >> 8) & 0xff);
}

static void put32(unsigned char* destination, uint32_t value) {
    destination[0] = static_cast<unsigned char>(value & 0xff);
    destination[1] = static_cast<unsigned char>((value >> 8) & 0xff);
    destination[2] = static_cast<unsigned char>((value >> 16) & 0xff);
    destination[3] = static_cast<unsigned char>((value >> 24) & 0xff);
}

static bool writeWaveHeader(FILE* output, uint32_t dataBytes) {
    unsigned char header[44] = {};
    memcpy(header, "RIFF", 4); put32(header + 4, 36u + dataBytes); memcpy(header + 8, "WAVEfmt ", 8);
    put32(header + 16, 16); put16(header + 20, 1); put16(header + 22, 1);
    put32(header + 24, 16000); put32(header + 28, 32000); put16(header + 32, 2); put16(header + 34, 16);
    memcpy(header + 36, "data", 4); put32(header + 40, dataBytes);
    return fseek(output, 0, SEEK_SET) == 0 && fwrite(header, 1, sizeof(header), output) == sizeof(header);
}

static int decodeToPcm(const wchar_t* input, const wchar_t* outputPath, DWORD streamIndex) {
    ComPtr<IMFAttributes> attributes;
    HRESULT status = MFCreateAttributes(&attributes, 1);
    if (FAILED(status) || FAILED(attributes->SetUINT32(MF_SOURCE_READER_ENABLE_AUDIO_PROCESSING, TRUE))) {
        return fail("decode attributes unavailable", 72);
    }
    ComPtr<IMFSourceReader> reader;
    status = MFCreateSourceReaderFromURL(input, attributes.Get(), &reader);
    if (FAILED(status)) return fail("decode source unavailable", 73);
    ComPtr<IMFMediaType> nativeType;
    status = reader->GetNativeMediaType(streamIndex, 0, &nativeType);
    GUID major = GUID_NULL;
    if (FAILED(status) || FAILED(nativeType->GetGUID(MF_MT_MAJOR_TYPE, &major)) || major != MFMediaType_Audio) {
        return fail("audio track unavailable", 74);
    }
    if (FAILED(reader->SetStreamSelection(MF_SOURCE_READER_ALL_STREAMS, FALSE))
        || FAILED(reader->SetStreamSelection(streamIndex, TRUE))) return fail("track selection unavailable", 75);
    ComPtr<IMFMediaType> outputType;
    if (FAILED(MFCreateMediaType(&outputType))
        || FAILED(outputType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio))
        || FAILED(outputType->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_PCM))
        || FAILED(outputType->SetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, 16))
        || FAILED(outputType->SetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, 16000))
        || FAILED(outputType->SetUINT32(MF_MT_AUDIO_NUM_CHANNELS, 1))
        || FAILED(outputType->SetUINT32(MF_MT_AUDIO_BLOCK_ALIGNMENT, 2))
        || FAILED(outputType->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND, 32000))
        || FAILED(outputType->SetUINT32(MF_MT_ALL_SAMPLES_INDEPENDENT, TRUE))
        || FAILED(reader->SetCurrentMediaType(streamIndex, nullptr, outputType.Get()))) {
        return fail("PCM conversion unavailable", 76);
    }
    FILE* output = nullptr;
    if (_wfopen_s(&output, outputPath, L"wb+") != 0 || output == nullptr) return fail("decode output unavailable", 77);
    bool succeeded = writeWaveHeader(output, 0);
    uint64_t total = 0;
    while (succeeded) {
        DWORD flags = 0;
        ComPtr<IMFSample> sample;
        status = reader->ReadSample(streamIndex, 0, nullptr, &flags, nullptr, &sample);
        if (FAILED(status) || (flags & MF_SOURCE_READERF_ERROR) != 0) { succeeded = false; break; }
        if (sample) {
            ComPtr<IMFMediaBuffer> buffer;
            if (FAILED(sample->ConvertToContiguousBuffer(&buffer))) { succeeded = false; break; }
            BYTE* data = nullptr;
            DWORD current = 0;
            if (FAILED(buffer->Lock(&data, nullptr, &current))) { succeeded = false; break; }
            if (current > 0 && (total + current > UINT32_MAX || fwrite(data, 1, current, output) != current)) {
                succeeded = false;
            }
            buffer->Unlock();
            if (!succeeded) break;
            total += current;
        }
        if ((flags & MF_SOURCE_READERF_ENDOFSTREAM) != 0) break;
    }
    if (succeeded) succeeded = writeWaveHeader(output, static_cast<uint32_t>(total)) && fflush(output) == 0;
    fclose(output);
    if (!succeeded) { DeleteFileW(outputPath); return fail("decode failed", 78); }
    const double durationMs = static_cast<double>(total) / 32000.0 * 1000.0;
    std::cout << "{\"schema\":\"t5.audio-decode.v1\",\"bytes\":" << total
              << ",\"durationMs\":" << std::fixed << std::setprecision(3) << durationMs
              << ",\"sampleRate\":16000,\"channels\":1,\"coverage\":\"complete\"}\n";
    return 0;
}

int wmain(int argc, wchar_t** argv) {
    const bool inspect = argc == 3 && wcscmp(argv[1], L"--inspect") == 0;
    const bool decode = argc == 5 && wcscmp(argv[1], L"--decode") == 0;
    if (!inspect && !decode) return fail("usage", 64);
    HRESULT status = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(status)) return fail("COM unavailable", 65);
    status = MFStartup(MF_VERSION, decode ? MFSTARTUP_FULL : MFSTARTUP_LITE);
    if (FAILED(status)) { CoUninitialize(); return fail("Media Foundation unavailable", 66); }
    int exitCode = 0;
    if (decode) {
        wchar_t* end = nullptr;
        const unsigned long parsed = wcstoul(argv[4], &end, 10);
        if (end == argv[4] || *end != L'\0' || parsed >= 32) exitCode = fail("track index invalid", 79);
        else exitCode = decodeToPcm(argv[2], argv[3], static_cast<DWORD>(parsed));
        MFShutdown(); CoUninitialize(); return exitCode;
    }
    do {
        ComPtr<IMFSourceReader> reader;
        status = MFCreateSourceReaderFromURL(argv[2], nullptr, &reader);
        if (FAILED(status)) { exitCode = fail("media unavailable", 67); break; }
        PROPVARIANT durationValue;
        PropVariantInit(&durationValue);
        status = reader->GetPresentationAttribute(MF_SOURCE_READER_MEDIASOURCE, MF_PD_DURATION, &durationValue);
        if (FAILED(status) || durationValue.vt != VT_UI8) {
            PropVariantClear(&durationValue); exitCode = fail("duration unavailable", 68); break;
        }
        const double durationMs = static_cast<double>(durationValue.uhVal.QuadPart) / 10000.0;
        PropVariantClear(&durationValue);
        if (!(durationMs >= 0.0) || durationMs > 7.0 * 24.0 * 60.0 * 60.0 * 1000.0) {
            exitCode = fail("duration invalid", 69); break;
        }
        std::string container;
        PROPVARIANT mimeValue;
        PropVariantInit(&mimeValue);
        if (SUCCEEDED(reader->GetPresentationAttribute(MF_SOURCE_READER_MEDIASOURCE, MF_PD_MIME_TYPE, &mimeValue))
            && mimeValue.vt == VT_LPWSTR) container = utf8(mimeValue.pwszVal);
        PropVariantClear(&mimeValue);
        std::vector<Track> tracks;
        for (DWORD index = 0; index < 32; ++index) {
            ComPtr<IMFMediaType> type;
            status = reader->GetNativeMediaType(index, 0, &type);
            if (status == MF_E_INVALIDSTREAMNUMBER) break;
            if (FAILED(status)) { exitCode = fail("stream unavailable", 70); break; }
            GUID major = GUID_NULL;
            GUID subtype = GUID_NULL;
            if (FAILED(type->GetGUID(MF_MT_MAJOR_TYPE, &major)) || FAILED(type->GetGUID(MF_MT_SUBTYPE, &subtype))) {
                exitCode = fail("stream format unavailable", 71); break;
            }
            const std::string kind = major == MFMediaType_Audio ? "audio"
                : major == MFMediaType_Video ? "video" : "other";
            UINT32 sampleRate = 0;
            UINT32 channels = 0;
            if (kind == "audio") {
                type->GetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, &sampleRate);
                type->GetUINT32(MF_MT_AUDIO_NUM_CHANNELS, &channels);
            }
            tracks.push_back({ index, index + 1, kind, codecIdentifier(subtype), sampleRate, channels,
                               languageFor(reader.Get(), index) });
        }
        if (exitCode != 0) break;
        size_t audioCount = 0;
        size_t videoCount = 0;
        for (const Track& track : tracks) {
            if (track.kind == "audio") ++audioCount;
            if (track.kind == "video") ++videoCount;
        }
        std::cout << "{\"schema\":\"t5.audio-reality.v1\",\"container\":{"
                  << "\"identifier\":" << (container.empty() ? "null" : "\"" + json(container) + "\"")
                  << ",\"evidence\":\"" << (container.empty() ? "unavailable" : "media_foundation_presentation")
                  << "\"},\"durationMs\":" << std::fixed << std::setprecision(3) << durationMs
                  << ",\"tracks\":[";
        for (size_t index = 0; index < tracks.size(); ++index) {
            if (index > 0) std::cout << ',';
            const Track& track = tracks[index];
            std::cout << "{\"index\":" << track.index << ",\"trackId\":" << track.trackId
                      << ",\"kind\":\"" << track.kind << "\",\"codec\":\"" << json(track.codec) << "\""
                      << ",\"sampleRate\":" << (track.sampleRate == 0 ? "null" : std::to_string(track.sampleRate))
                      << ",\"channels\":" << (track.channels == 0 ? "null" : std::to_string(track.channels))
                      << ",\"languageTag\":" << (track.language.empty() ? "null" : "\"" + json(track.language) + "\"")
                      << '}';
        }
        std::cout << "],\"audioTrackCount\":" << audioCount << ",\"videoTrackCount\":" << videoCount
                  << ",\"coverage\":\"complete\"}\n";
    } while (false);
    MFShutdown();
    CoUninitialize();
    return exitCode;
}
