#define _SILENCE_EXPERIMENTAL_COROUTINE_DEPRECATION_WARNINGS

#include <windows.h>
#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Globalization.h>
#include <winrt/Windows.Graphics.Imaging.h>
#include <winrt/Windows.Media.Ocr.h>
#include <winrt/Windows.Storage.h>
#include <winrt/Windows.Storage.Streams.h>

#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

using namespace winrt;
using namespace Windows::Foundation;
using namespace Windows::Globalization;
using namespace Windows::Graphics::Imaging;
using namespace Windows::Media::Ocr;
using namespace Windows::Storage;
using namespace Windows::Storage::Streams;

namespace {
constexpr size_t kMaximumObservations = 200;

std::string utf8(hstring const& value) {
  if (value.empty()) return {};
  const int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.c_str(),
    static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  if (size <= 0) throw hresult_error(HRESULT_FROM_WIN32(GetLastError()));
  std::string output(static_cast<size_t>(size), '\0');
  if (WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.c_str(),
      static_cast<int>(value.size()), output.data(), size, nullptr, nullptr) != size) {
    throw hresult_error(HRESULT_FROM_WIN32(GetLastError()));
  }
  return output;
}

std::string json_string(hstring const& value) {
  std::ostringstream output;
  output << '"';
  for (unsigned char byte : utf8(value)) {
    switch (byte) {
      case '"': output << "\\\""; break;
      case '\\': output << "\\\\"; break;
      case '\b': output << "\\b"; break;
      case '\f': output << "\\f"; break;
      case '\n': output << "\\n"; break;
      case '\r': output << "\\r"; break;
      case '\t': output << "\\t"; break;
      default:
        if (byte < 0x20) {
          output << "\\u" << std::hex << std::setw(4) << std::setfill('0')
            << static_cast<int>(byte) << std::dec;
        } else output << static_cast<char>(byte);
    }
  }
  output << '"';
  return output.str();
}

struct Observation {
  hstring text;
  Rect box;
};
}

int wmain(int argc, wchar_t** argv) {
  if (argc != 3 || std::wstring_view(argv[1]) != L"--ocr-image") {
    std::wcerr << L"usage: t5-windows-image-ocr.exe --ocr-image <absolute-path>\n";
    return 2;
  }
  try {
    init_apartment(apartment_type::multi_threaded);
    const auto file = StorageFile::GetFileFromPathAsync(argv[2]).get();
    const auto stream = file.OpenAsync(FileAccessMode::Read).get();
    const auto decoder = BitmapDecoder::CreateAsync(stream).get();
    const auto bitmap = decoder.GetSoftwareBitmapAsync(BitmapPixelFormat::Bgra8,
      BitmapAlphaMode::Premultiplied).get();
    auto engine = OcrEngine::TryCreateFromLanguage(Language(L"ko-KR"));
    if (!engine) engine = OcrEngine::TryCreateFromUserProfileLanguages();
    if (!engine) {
      std::cerr << "Windows OCR language support is unavailable\n";
      return 3;
    }
    const auto result = engine.RecognizeAsync(bitmap).get();
    std::vector<Observation> observations;
    bool truncated = false;
    for (const auto& line : result.Lines()) {
      for (const auto& word : line.Words()) {
        if (observations.size() == kMaximumObservations) { truncated = true; break; }
        observations.push_back({ word.Text(), word.BoundingRect() });
      }
      if (truncated) break;
    }
    const double width = static_cast<double>(bitmap.PixelWidth());
    const double height = static_cast<double>(bitmap.PixelHeight());
    if (width <= 0 || height <= 0) return 4;
    std::cout << "{\"schema\":\"t5.local-image-ocr.v1\",\"width\":"
      << bitmap.PixelWidth() << ",\"height\":" << bitmap.PixelHeight()
      << ",\"truncated\":" << (truncated ? "true" : "false") << ",\"observations\":[";
    for (size_t index = 0; index < observations.size(); ++index) {
      if (index) std::cout << ',';
      const auto& item = observations[index];
      std::cout << "{\"text\":" << json_string(item.text) << ",\"confidence\":null,\"box\":{"
        << "\"x\":" << (item.box.X / width) << ",\"y\":" << (item.box.Y / height)
        << ",\"width\":" << (item.box.Width / width) << ",\"height\":" << (item.box.Height / height)
        << "}}";
    }
    std::cout << "]}\n";
    return 0;
  } catch (hresult_error const& error) {
    std::wcerr << L"Windows OCR failed (0x" << std::hex << static_cast<unsigned long>(error.code().value)
      << L")\n";
    return 5;
  } catch (...) {
    std::cerr << "Windows OCR failed\n";
    return 6;
  }
}
