#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mfapi.h>
#include <mferror.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <propvarutil.h>
#include <wrl/client.h>

#include <cstdint>
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

int wmain(int argc, wchar_t** argv) {
    if (argc != 3 || wcscmp(argv[1], L"--inspect") != 0) return fail("usage", 64);
    HRESULT status = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(status)) return fail("COM unavailable", 65);
    status = MFStartup(MF_VERSION, MFSTARTUP_LITE);
    if (FAILED(status)) { CoUninitialize(); return fail("Media Foundation unavailable", 66); }
    int exitCode = 0;
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
