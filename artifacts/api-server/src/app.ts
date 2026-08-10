import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// This is a dynamic JSON API, not cacheable content. Express's default
// weak ETag + conditional-GET support can make the client-side fetch layer
// receive a 304 Not Modified for an endpoint whose underlying data just
// changed (e.g. right after a POST), which the generated API client
// (customFetch) treats as "no body" and resolves as `null` instead of the
// real payload — silently breaking UI refreshes after mutations. Disable
// ETags and force clients to always fetch a fresh body.
app.set("etag", false);
app.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// Higher limit to accommodate base64-encoded PDF uploads for recipe ingestion.
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

app.use("/api", router);

export default app;
