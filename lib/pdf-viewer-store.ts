export type PdfViewerFileRecord = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  blob: Blob;
  createdAt: number;
};

const PDF_VIEWER_DB_NAME = "item-key-pdf-viewer";
const PDF_VIEWER_DB_VERSION = 1;
const PDF_VIEWER_STORE_NAME = "files";
const PDF_VIEWER_FILE_TTL_MS = 30 * 60 * 1000;

function openPdfViewerDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("В этом браузере недоступно временное хранилище PDF."));
      return;
    }

    const request = indexedDB.open(PDF_VIEWER_DB_NAME, PDF_VIEWER_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PDF_VIEWER_STORE_NAME)) {
        database.createObjectStore(PDF_VIEWER_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onerror = () => {
      reject(request.error ?? new Error("Не удалось открыть временное хранилище PDF."));
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("Операция с PDF не удалась."));
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error("Операция с PDF была отменена."));
    };
  });
}

function waitForRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => {
      reject(request.error ?? new Error("Операция с PDF не удалась."));
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

export async function deleteExpiredPdfViewerFiles(
  maxAgeMs = PDF_VIEWER_FILE_TTL_MS
): Promise<void> {
  const database = await openPdfViewerDatabase();

  try {
    const cutoff = Date.now() - maxAgeMs;
    const transaction = database.transaction(PDF_VIEWER_STORE_NAME, "readwrite");
    const store = transaction.objectStore(PDF_VIEWER_STORE_NAME);
    const request = store.openCursor();

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        return;
      }

      const value = cursor.value as Partial<PdfViewerFileRecord>;
      if (typeof value.createdAt !== "number" || value.createdAt < cutoff) {
        cursor.delete();
      }
      cursor.continue();
    };

    await waitForTransaction(transaction);
  } finally {
    database.close();
  }
}

export async function storePdfViewerFile(record: PdfViewerFileRecord): Promise<void> {
  await deleteExpiredPdfViewerFiles().catch(() => {
    return;
  });

  const database = await openPdfViewerDatabase();

  try {
    const transaction = database.transaction(PDF_VIEWER_STORE_NAME, "readwrite");
    transaction.objectStore(PDF_VIEWER_STORE_NAME).put(record);
    await waitForTransaction(transaction);
  } finally {
    database.close();
  }
}

export async function getPdfViewerFile(
  id: string
): Promise<PdfViewerFileRecord | null> {
  const normalizedId = id.trim();
  if (!normalizedId) {
    return null;
  }

  const database = await openPdfViewerDatabase();

  try {
    const transaction = database.transaction(PDF_VIEWER_STORE_NAME, "readonly");
    const request = transaction
      .objectStore(PDF_VIEWER_STORE_NAME)
      .get(normalizedId) as IDBRequest<PdfViewerFileRecord | undefined>;
    const record = (await waitForRequest(request)) ?? null;
    await waitForTransaction(transaction);
    return record;
  } finally {
    database.close();
  }
}
