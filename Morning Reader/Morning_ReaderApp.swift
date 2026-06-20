import SwiftUI
import SwiftData

@main
struct Morning_ReaderApp: App {
    let container: ModelContainer

    init() {
        let schema = Schema([Child.self, PDFBook.self, ReadingSession.self])
        let config = ModelConfiguration(schema: schema, isStoredInMemoryOnly: false)
        do {
            let c = try ModelContainer(for: schema, configurations: [config])
            seedIfNeeded(context: c.mainContext)
            container = c
        } catch {
            fatalError("Failed to create ModelContainer: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .modelContainer(container)
    }

    private func seedIfNeeded(context: ModelContext) {
        let descriptor = FetchDescriptor<Child>()
        let existing = (try? context.fetch(descriptor)) ?? []
        guard existing.isEmpty else { return }

        let mike = Child(name: "Mike")
        let mikeBooks = [
            PDFBook(title: "Level 5 Book 3", fileName: "Level5_Book3.pdf", level: "Level 5", bookNumber: 3, sortOrder: 0),
            PDFBook(title: "Level 5 Book 4", fileName: "Level5_Book4.pdf", level: "Level 5", bookNumber: 4, sortOrder: 1),
            PDFBook(title: "Level 5 Book 5", fileName: "Level5_Book5.pdf", level: "Level 5", bookNumber: 5, sortOrder: 2),
        ]
        for book in mikeBooks {
            context.insert(book)
            mike.pdfBooks.append(book)
        }

        let peyton = Child(name: "Peyton")
        let peytonBooks = [
            PDFBook(title: "Level 2 Book 1", fileName: "Level2_Book1.pdf", level: "Level 2", bookNumber: 1, sortOrder: 0),
            PDFBook(title: "Level 2 Book 2", fileName: "Level2_Book2.pdf", level: "Level 2", bookNumber: 2, sortOrder: 1),
            PDFBook(title: "Level 2 Book 3", fileName: "Level2_Book3.pdf", level: "Level 2", bookNumber: 3, sortOrder: 2),
        ]
        for book in peytonBooks {
            context.insert(book)
            peyton.pdfBooks.append(book)
        }

        context.insert(mike)
        context.insert(peyton)
        try? context.save()
    }
}
