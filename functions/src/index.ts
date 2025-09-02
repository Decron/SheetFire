// functions/src/index.ts
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import type { Request, Response } from 'express';

admin.initializeApp();
const db = admin.firestore();

// Secret managed via: firebase functions:secrets:set APP_SECRET
const APP_SECRET = defineSecret('APP_SECRET');

// Optional: basic allowlist/shape check for collection names (alphanum, dashes/underscores)
const COLLECTION_RE = /^[A-Za-z0-9_-]{1,128}$/;

// Region is configurable via environment variable set at deploy time
// Fallback to 'us-central1' if not provided. Use globalThis to avoid needing @types/node.
const REGION = (globalThis as any)?.process?.env?.REGION || 'us-central1';

type IncomingBody = {
  collection?: string;
  doc?: Record<string, unknown>;
  docId?: string;
  merge?: boolean;   // optional, defaults true
  dryRun?: boolean;  // optional: validate but don’t write
};

function setCors(res: Response) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-secret');
}

export const adminAddDoc = onRequest(
  { region: REGION, secrets: [APP_SECRET] },
  async (req: Request, res: Response) => {
    setCors(res);

    try {
      // Preflight support (handy if you ever hit this from a browser)
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }

      if (req.method !== 'POST') {
        res.status(405).send('POST only');
        return;
      }

      // Shared-secret header gate
      const secret = req.get('x-app-secret');
      if (!secret || secret !== APP_SECRET.value()) {
        res.status(401).send('Unauthorized');
        return;
      }

      // Body parsing & validation
      const body = (req.body ?? {}) as IncomingBody;

      const { collection, doc, docId, merge = true, dryRun = false } = body;

      if (!collection || !COLLECTION_RE.test(collection)) {
        res.status(400).send('Bad collection: must be [A-Za-z0-9_-], 1–128 chars');
        return;
      }

      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
        res.status(400).send('Bad payload: "doc" must be an object');
        return;
      }

      if (docId && typeof docId !== 'string') {
        res.status(400).send('Bad payload: "docId" must be a string when provided');
        return;
      }

      // Prepare write
      const colRef = db.collection(collection);
      const docRef = docId ? colRef.doc(docId) : colRef.doc();

      // Server timestamps
      const nowServer = admin.firestore.FieldValue.serverTimestamp();

      const payload = {
        ...doc,
        createdAt: admin.firestore.FieldValue.serverTimestamp(), // will not overwrite if merge + field exists (depends on client)
        updatedAt: nowServer,
      };

      if (dryRun) {
        // No write, just echo what would happen
        res.status(200).json({
          ok: true,
          dryRun: true,
          wouldWriteTo: `${collection}/${docRef.id}`,
          merge,
          payload,
        });
        return;
      }

      const writeResult = await docRef.set(payload as Record<string, unknown>, { merge });

      // writeResult.writeTime exists on Admin SDK set()
      // but we’ll also fetch the write time from the returned object when available
      res.status(200).json({
        ok: true,
        id: docRef.id,
        path: `${collection}/${docRef.id}`,
        merge,
        writeTime: (writeResult as unknown as { writeTime?: { toDate: () => Date } }).writeTime
          ? (writeResult as any).writeTime.toDate().toISOString()
          : undefined,
      });
    } catch (err) {
      const e = err as Error;
      logger.error(e);
      // Normalize some common Cloud Run / Firestore errors
      const msg = e?.message || 'Unknown error';
      if (/PERMISSION_DENIED/i.test(msg)) {
        res.status(403).send('Permission denied (check Cloud Run Invoker and project/region)');
        return;
      }
      res.status(500).send(msg);
    }
  }
);
