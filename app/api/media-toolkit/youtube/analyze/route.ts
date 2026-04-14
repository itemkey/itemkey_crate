import { toErrorMessage } from "@/lib/errors";
import {
  analyzeYoutubeResolutions,
  YoutubeToolkitError,
} from "@/lib/media-toolkit/youtube";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AnalyzeRequestPayload = {
  url?: unknown;
  cookiesBrowser?: unknown;
  cookiesProfile?: unknown;
  poToken?: unknown;
};

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AnalyzeRequestPayload;
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) {
      return Response.json(
        {
          error: "Ссылка YouTube не может быть пустой.",
        },
        { status: 400 }
      );
    }

    const resolutions = await analyzeYoutubeResolutions(url, {
      cookiesBrowser: asOptionalString(body.cookiesBrowser),
      cookiesProfile: asOptionalString(body.cookiesProfile),
      poToken: asOptionalString(body.poToken),
    });

    if (resolutions.length === 0) {
      return Response.json(
        {
          error: "Не найдено доступных разрешений.",
        },
        { status: 404 }
      );
    }

    return Response.json(
      {
        data: {
          resolutions,
        },
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    const statusCode = error instanceof YoutubeToolkitError ? error.statusCode : 500;
    const fallback =
      statusCode >= 500
        ? "Не удалось получить доступные разрешения на сервере."
        : "Не удалось получить доступные разрешения.";

    return Response.json(
      {
        error: toErrorMessage(error, fallback),
      },
      {
        status: statusCode,
      }
    );
  }
}
