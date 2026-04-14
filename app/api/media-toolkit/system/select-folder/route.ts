import { spawn } from "node:child_process";

import { toErrorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

class FolderPickerError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "FolderPickerError";
    this.statusCode = statusCode;
  }
}

function mapPowerShellError(stderr: string): string {
  const normalized = stderr.trim().toLowerCase();
  if (!normalized) {
    return "Не удалось открыть выбор папки.";
  }

  if (normalized.includes("new-object") && normalized.includes("comobject")) {
    return "Выбор папки недоступен в этой среде запуска.";
  }

  if (normalized.includes("cannot start process") || normalized.includes("not recognized")) {
    return "PowerShell недоступен в системе.";
  }

  return "Не удалось открыть выбор папки.";
}

async function openFolderDialog(): Promise<string | null> {
  return new Promise<string | null>((resolve, reject) => {
    const script =
      "$ErrorActionPreference='Stop';" +
      "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;" +
      "$shell=New-Object -ComObject Shell.Application;" +
      "$folder=$shell.BrowseForFolder(0,'Выберите папку назначения',0,0);" +
      "if($null -ne $folder){[Console]::WriteLine($folder.Self.Path)}";

    const child = spawn(
      "powershell",
      ["-NoProfile", "-STA", "-Command", script],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: false,
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new FolderPickerError("PowerShell не найден в системе.", 500));
        return;
      }

      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new FolderPickerError(mapPowerShellError(stderr), 500));
        return;
      }

      const selectedPath = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);

      resolve(selectedPath ?? null);
    });
  });
}

export async function POST() {
  try {
    const selectedPath = await openFolderDialog();

    return Response.json(
      {
        data: {
          path: selectedPath,
        },
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    const statusCode = error instanceof FolderPickerError ? error.statusCode : 500;
    return Response.json(
      {
        error: toErrorMessage(error, "Не удалось открыть выбор папки."),
      },
      {
        status: statusCode,
      }
    );
  }
}
