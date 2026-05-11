import { ApiError } from "./errors";

type Handler<Ctx> = (req: Request, ctx: Ctx) => Promise<unknown> | unknown;

type DefaultRouteCtx = { params: Promise<Record<string, string | string[]>> };

export function apiHandler<Ctx = DefaultRouteCtx>(handler: Handler<Ctx>) {
  return async (req: Request, ctx?: Ctx): Promise<Response> => {
    try {
      const result = await handler(req, ctx as Ctx);
      if (result === undefined || result === null) {
        return new Response(null, { status: 204 });
      }
      return Response.json(result);
    } catch (err) {
      if (err instanceof ApiError) {
        return Response.json(
          {
            error: {
              code: err.code,
              message: err.message,
              ...(err.details !== undefined ? { details: err.details } : {}),
            },
          },
          { status: err.status },
        );
      }
      console.error("Unhandled API error:", err);
      return Response.json(
        { error: { code: "internal", message: "Internal server error" } },
        { status: 500 },
      );
    }
  };
}
