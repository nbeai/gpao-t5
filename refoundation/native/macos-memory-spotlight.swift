import CoreSpotlight
import Foundation
import UniformTypeIdentifiers

private struct SearchItem: Codable {
    let identifier: String
    let domain: String
    let memoryId: String
    let revision: Int
    let title: String
    let content: String
    let contentDigest: String
}

private struct Request: Codable {
    let operation: String
    let indexName: String
    let domain: String
    let identifiers: [String]?
    let items: [SearchItem]?
}

private struct Response: Codable {
    let ok: Bool
    let available: Bool?
    let items: [SearchItem]?
    let errorKind: String?
}

private func bounded(_ value: String, maximum: Int = 4096) -> Bool {
    !value.isEmpty && value.utf8.count <= maximum && value.unicodeScalars.allSatisfy {
        !CharacterSet.controlCharacters.contains($0)
    }
}

private func safeIdentity(_ value: String) -> Bool {
    bounded(value, maximum: 512) && value.range(of: #"^[A-Za-z0-9._:-]+$"#, options: .regularExpression) != nil
}

private func write(_ response: Response, exitCode: Int32 = 0) -> Never {
    do {
        FileHandle.standardOutput.write(try JSONEncoder().encode(response))
        FileHandle.standardOutput.write(Data([0x0a]))
    } catch {
        fputs("spotlight response encoding failed\n", stderr)
        exit(70)
    }
    exit(exitCode)
}

private func errorKind(_ error: Error?) -> String? {
    guard let error else { return nil }
    let value = error as NSError
    return "\(value.domain):\(value.code)"
}

private func digestKeyword(_ digest: String) -> String { "t5digest:\(digest)" }
private func revisionKeyword(_ revision: Int) -> String { "t5revision:\(revision)" }
private func memoryKeyword(_ memoryId: String) -> String { "t5memory:\(memoryId)" }

private func decodeItem(_ item: CSSearchableItem) -> SearchItem? {
    guard let domain = item.domainIdentifier,
          let title = item.attributeSet.title,
          let content = item.attributeSet.contentDescription else { return nil }
    let keywords = item.attributeSet.keywords ?? []
    guard let digest = keywords.first(where: { $0.hasPrefix("t5digest:") }).map({ String($0.dropFirst(9)) }),
          let revisionText = keywords.first(where: { $0.hasPrefix("t5revision:") }).map({ String($0.dropFirst(11)) }),
          let revision = Int(revisionText),
          let memoryId = keywords.first(where: { $0.hasPrefix("t5memory:") }).map({ String($0.dropFirst(9)) })
    else { return nil }
    return SearchItem(identifier: item.uniqueIdentifier, domain: domain, memoryId: memoryId,
                      revision: revision, title: title, content: content, contentDigest: digest)
}

let inputData = FileHandle.standardInput.readDataToEndOfFile()
guard !inputData.isEmpty, let request = try? JSONDecoder().decode(Request.self, from: inputData),
      safeIdentity(request.indexName), safeIdentity(request.domain) else {
    write(Response(ok: false, available: nil, items: nil, errorKind: "invalid_request"), exitCode: 64)
}

if request.operation == "available" {
    write(Response(ok: true, available: CSSearchableIndex.isIndexingAvailable(), items: nil, errorKind: nil))
}

let index = CSSearchableIndex(name: request.indexName)
if request.operation == "index" {
    let values = request.items ?? []
    guard values.count <= 100, values.allSatisfy({ item in
        safeIdentity(item.identifier) && item.domain == request.domain && safeIdentity(item.memoryId)
            && item.revision > 0 && bounded(item.title, maximum: 256) && bounded(item.content)
            && item.contentDigest.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil
    }) else { write(Response(ok: false, available: nil, items: nil, errorKind: "invalid_items"), exitCode: 64) }
    let searchable = values.map { value -> CSSearchableItem in
        let attributes = CSSearchableItemAttributeSet(contentType: UTType.text)
        attributes.title = value.title
        attributes.contentDescription = value.content
        attributes.domainIdentifier = value.domain
        attributes.keywords = [digestKeyword(value.contentDigest), revisionKeyword(value.revision),
                               memoryKeyword(value.memoryId)]
        let item = CSSearchableItem(uniqueIdentifier: value.identifier,
                                    domainIdentifier: value.domain, attributeSet: attributes)
        item.expirationDate = Date.distantFuture
        return item
    }
    let semaphore = DispatchSemaphore(value: 0)
    var failure: Error?
    index.indexSearchableItems(searchable) { error in failure = error; semaphore.signal() }
    guard semaphore.wait(timeout: .now() + 10) == .success else {
        write(Response(ok: false, available: nil, items: nil, errorKind: "timeout"), exitCode: 75)
    }
    write(Response(ok: failure == nil, available: nil, items: nil, errorKind: errorKind(failure)),
          exitCode: failure == nil ? 0 : 1)
}

if request.operation == "delete" {
    let identifiers = request.identifiers ?? []
    guard identifiers.count <= 100, identifiers.allSatisfy(safeIdentity) else {
        write(Response(ok: false, available: nil, items: nil, errorKind: "invalid_identifiers"), exitCode: 64)
    }
    let semaphore = DispatchSemaphore(value: 0)
    var failure: Error?
    index.deleteSearchableItems(withIdentifiers: identifiers) { error in failure = error; semaphore.signal() }
    guard semaphore.wait(timeout: .now() + 10) == .success else {
        write(Response(ok: false, available: nil, items: nil, errorKind: "timeout"), exitCode: 75)
    }
    write(Response(ok: failure == nil, available: nil, items: nil, errorKind: errorKind(failure)),
          exitCode: failure == nil ? 0 : 1)
}

if request.operation == "list" {
    let context = CSSearchQueryContext()
    context.fetchAttributes = ["title", "contentDescription", "keywords", "domainIdentifier"]
    let query = CSSearchQuery(queryString: "domainIdentifier == \"\(request.domain)\"c", queryContext: context)
    let semaphore = DispatchSemaphore(value: 0)
    var found: [CSSearchableItem] = []
    var failure: Error?
    query.foundItemsHandler = { items in found.append(contentsOf: items) }
    query.completionHandler = { error in failure = error; semaphore.signal() }
    query.start()
    guard semaphore.wait(timeout: .now() + 10) == .success else {
        query.cancel()
        write(Response(ok: false, available: nil, items: nil, errorKind: "timeout"), exitCode: 75)
    }
    let values = found.compactMap(decodeItem).filter { $0.domain == request.domain }
    write(Response(ok: failure == nil, available: nil, items: values, errorKind: errorKind(failure)),
          exitCode: failure == nil ? 0 : 1)
}

write(Response(ok: false, available: nil, items: nil, errorKind: "unknown_operation"), exitCode: 64)
