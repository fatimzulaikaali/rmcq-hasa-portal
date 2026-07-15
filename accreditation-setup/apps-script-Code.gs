/**
 * RMCQ-HASA Accreditation — Google Drive folder sync web app
 * Runs in the Gmail account that owns the accreditation Drive folder.
 *
 * DEPLOY:
 *   1. script.google.com  (signed in as the evidence Gmail account) → New project
 *   2. Paste this whole file over the default Code.gs
 *   3. Change SECRET below to a long random string (keep it private)
 *   4. Deploy → New deployment → type = Web app
 *        Execute as: Me
 *        Who has access: Anyone with the link
 *      → Deploy → authorise (Advanced → Go to project → Allow)
 *   5. Copy the Web app URL. Give it + the SECRET + your root folder ID to the portal env.
 *
 * The portal ALWAYS sends rootFolderId, so this script only ever touches
 * that one folder tree. It never deletes anything. It is idempotent:
 * a folder is only created if one with the same name does not already exist
 * under its parent, so re-running to add a new year never makes duplicates.
 */

const SECRET = 'REPLACE_WITH_A_LONG_RANDOM_STRING';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) {
      return json({ ok: false, error: 'unauthorized' });
    }
    const action = body.action || 'sync';
    if (action === 'ping') return json({ ok: true, pong: true });
    if (action === 'sync') return json(handleSync(body));
    if (action === 'list') return json(handleList(body));
    if (action === 'upload') return json(handleUpload(body));
    return json({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function handleSync(body) {
  if (!body.rootFolderId) {
    return { ok: false, error: 'rootFolderId is required' };
  }
  const root = DriveApp.getFolderById(body.rootFolderId);

  // Optional service-level folder inside the root (e.g. the department/service name)
  let base = root;
  if (body.service) base = ensureFolder(body.service, root);

  const out = [];
  (body.items || []).forEach(function (item) {
    // one folder per evidence item, e.g. "24.1.1.1 (1)"
    const parent = ensureFolder(item.evidenceKey, base);
    const years = (item.years || []).map(function (y) {
      const yf = ensureFolder(String(y), parent);
      return { year: y, folderId: yf.getId(), url: yf.getUrl() };
    });
    out.push({
      evidenceKey: item.evidenceKey,
      folderId: parent.getId(),
      url: parent.getUrl(),
      years: years
    });
  });

  return {
    ok: true,
    rootFolderId: root.getId(),
    rootUrl: root.getUrl(),
    serviceFolderId: base.getId(),
    serviceFolderUrl: base.getUrl(),
    folders: out
  };
}

/**
 * List the files inside a folder so the portal can preview them in-app.
 * Returns id/name/mimeType/url for each file (not subfolders).
 */
function handleList(body) {
  if (!body.folderId) return { ok: false, error: 'folderId is required' };
  const folder = DriveApp.getFolderById(body.folderId);
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    files.push({
      id: f.getId(),
      name: f.getName(),
      mimeType: f.getMimeType(),
      url: f.getUrl()
    });
  }
  // also expose immediate subfolders, in case evidence is nested by sub-topic
  const subfolders = [];
  const fit = folder.getFolders();
  while (fit.hasNext()) {
    const sf = fit.next();
    subfolders.push({ id: sf.getId(), name: sf.getName(), url: sf.getUrl() });
  }
  return { ok: true, files: files, subfolders: subfolders };
}

/**
 * Upload a single file (sent base64-encoded) straight into a folder,
 * so users can add evidence from the portal without opening Drive.
 * Body: { folderId, name, mimeType, dataBase64 }
 */
function handleUpload(body) {
  if (!body.folderId) return { ok: false, error: 'folderId is required' };
  if (!body.dataBase64) return { ok: false, error: 'dataBase64 is required' };
  var folder = DriveApp.getFolderById(body.folderId);
  var bytes = Utilities.base64Decode(body.dataBase64);
  var blob = Utilities.newBlob(bytes, body.mimeType || 'application/octet-stream', body.name || 'upload');
  var file = folder.createFile(blob);
  return {
    ok: true,
    file: { id: file.getId(), name: file.getName(), mimeType: file.getMimeType(), url: file.getUrl() }
  };
}

/**
 * Return the existing folder with `name` directly under `parent`,
 * or create it if none exists. Scoped to the parent, so it never
 * matches folders elsewhere in the Drive. Idempotent.
 */
function ensureFolder(name, parent) {
  const existing = parent.getFoldersByName(name);
  if (existing.hasNext()) return existing.next();
  return parent.createFolder(name);
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
