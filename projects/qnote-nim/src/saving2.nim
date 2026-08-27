import models, saving

proc exportDocumentForHost*(doc: Document): string = serializeDoc(doc)

