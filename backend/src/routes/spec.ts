// POST /projects/:id/spec (owner: Person C, C3). README §7: multipart `file` → { chars }.
import { Router, type RequestHandler } from "express";
import multer from "multer";
import { getProject, getProjectPlanState, updateProjectPlanState } from "../db/db";
import { extractSpecText, SpecError } from "../spec/extract";

export const specRouter = Router();

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // Vercel caps request bodies at ~4.5 MB
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

/** Runs multer and turns its errors (file too big, wrong field) into readable 4xx answers. */
const receiveFile: RequestHandler = (req, res, next) => {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        error: err.code === "LIMIT_FILE_SIZE" ? "The spec file is too big (max 4 MB)." : `Upload the spec as a single "file" field (${err.message}).`,
      });
      return;
    }
    if (err) {
      next(err);
      return;
    }
    next();
  });
};

specRouter.post("/projects/:id/spec", receiveFile, async (req, res, next) => {
  let project, state;
  try {
    project = await getProject(req.params.id);
    state = await getProjectPlanState(req.params.id);
  } catch (e) {
    next(e);
    return;
  }
  if (!project || !state) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  // A new version may be uploaded at any time. On an active plan it only matters once someone runs
  // POST /taskmap/replan, which turns it into a proposed change the team signs.
  if (!req.file) {
    res.status(400).json({ error: 'Attach the spec as a "file" field.' });
    return;
  }

  extractSpecText(req.file)
    .then(async (text) => {
      await updateProjectPlanState(project.id, { specText: text });
      res.json({ chars: text.length });
    })
    .catch((e: unknown) => {
      if (e instanceof SpecError) {
        res.status(e.status).json({ error: e.message });
        return;
      }
      next(e);
    });
});
