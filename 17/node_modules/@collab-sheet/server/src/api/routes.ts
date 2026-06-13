import { Router, Request, Response } from 'express';
import { DocumentManager } from '../DocumentManager.js';
import type {
  DocumentMeta,
  Cell,
  PermissionRule,
  VersionSnapshot,
  VersionDiff,
} from '../types.js';
import type { Permission } from '../eventStore/types.js';
import { z } from 'zod';

export function createRoutes(documentManager: DocumentManager): Router {
  const router = Router();

  const createDocumentSchema = z.object({
    name: z.string().min(1),
    ownerId: z.string().min(1),
  });

  const updateCellSchema = z.object({
    row: z.number().int().positive(),
    col: z.number().int().positive(),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    userId: z.string().min(1),
  });

  const setPermissionSchema = z.object({
    userId: z.string().min(1),
    role: z.enum(['owner', 'editor', 'viewer']),
    grantedBy: z.string().min(1),
  });

  router.post('/documents', (req: Request, res: Response) => {
    try {
      const parsed = createDocumentSchema.parse(req.body);
      const doc: DocumentMeta = documentManager.createDocument(parsed.name, parsed.ownerId);
      res.status(201).json(doc);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: (error as Error).message });
      }
    }
  });

  router.get('/documents/:id', (req: Request, res: Response) => {
    try {
      const docId = req.params.id;
      const doc: DocumentMeta | null = documentManager.getDocumentMeta(docId);
      if (!doc) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }
      res.json(doc);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/documents/:id/versions', (req: Request, res: Response) => {
    try {
      const docId = req.params.id;
      const history = documentManager.getVersionHistory(docId);
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/documents/:id/versions/:versionId', (req: Request, res: Response) => {
    try {
      const docId = req.params.id;
      const versionId = parseInt(req.params.versionId, 10);
      if (isNaN(versionId)) {
        res.status(400).json({ error: 'Invalid versionId' });
        return;
      }
      const snapshot: VersionSnapshot | null = documentManager.getVersion(docId, versionId);
      if (!snapshot) {
        res.status(404).json({ error: 'Version not found' });
        return;
      }
      res.json(snapshot);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/documents/:id/diff', (req: Request, res: Response) => {
    try {
      const docId = req.params.id;
      const fromParam = req.query.from as string;
      const toParam = req.query.to as string;

      if (!fromParam || !toParam) {
        res.status(400).json({ error: 'from and to query parameters are required' });
        return;
      }

      const fromVersion = parseInt(fromParam, 10);
      const toVersion = parseInt(toParam, 10);

      if (isNaN(fromVersion) || isNaN(toVersion)) {
        res.status(400).json({ error: 'Invalid version numbers' });
        return;
      }

      const diff: VersionDiff = documentManager.getDiff(docId, fromVersion, toVersion);
      res.json(diff);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/documents/:id/rollback/:versionId', (req: Request, res: Response) => {
    try {
      const docId = req.params.id;
      const versionId = parseInt(req.params.versionId, 10);
      const userId = (req.body as { userId?: string })?.userId;

      if (isNaN(versionId)) {
        res.status(400).json({ error: 'Invalid versionId' });
        return;
      }

      if (!userId) {
        res.status(400).json({ error: 'userId is required in request body' });
        return;
      }

      const success = documentManager.rollbackToVersion(docId, versionId, userId);
      if (!success) {
        res.status(404).json({ error: 'Version not found' });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/documents/:id/permissions', (req: Request, res: Response) => {
    try {
      const docId = req.params.id;
      const rules: PermissionRule[] = documentManager.getPermissionRules(docId);
      res.json(rules);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/documents/:id/permissions', (req: Request, res: Response) => {
    try {
      const docId = req.params.id;
      const parsed = setPermissionSchema.parse(req.body);
      const permission: Permission = documentManager.setPermission(
        docId,
        parsed.userId,
        parsed.role,
        parsed.grantedBy
      );
      res.status(201).json(permission);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: (error as Error).message });
      }
    }
  });

  router.get('/documents/:id/sheets/:sheetId/cells', (req: Request, res: Response) => {
    try {
      const docId = req.params.id;
      const sheetId = req.params.sheetId;
      const userId = req.query.userId as string | undefined;
      const cells: Cell[] = documentManager.getCells(docId, sheetId, userId);
      res.json(cells);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  return router;
}
