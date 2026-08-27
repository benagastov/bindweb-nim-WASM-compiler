import models

type SyncState* = object
  lastRevision*: int
  dirty*: bool

proc updateSyncState*(sync: var SyncState; doc: Document) =
  sync.dirty = sync.lastRevision != doc.revision

proc markSynced*(sync: var SyncState; doc: Document) =
  sync.lastRevision = doc.revision
  sync.dirty = false

