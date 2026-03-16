const axios = require('axios');
const fs = require('fs');
const path = require('path');

const ADOBE_IMS_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';
const ADOBE_AUTH_URL = 'https://ims-na1.adobelogin.com/ims/authorize/v2';
const FRAMEIO_API = 'https://api.frame.io/v4';
const TOKEN_FILE = path.join(__dirname, '..', '.token-vol', 'token.json');
const SCOPES = 'email,profile,additional_info.roles,offline_access,openid';

let cachedToken = null;
let tokenExpiry = null;

// ---- Token file management ----

function readTokenFile() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
    }
  } catch {}
  return null;
}

function writeTokenFile(data) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function hasRefreshToken() {
  const data = readTokenFile();
  return !!(data && data.refresh_token);
}

// ---- Adobe IMS OAuth ----

function getAuthorizeUrl() {
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const params = new URLSearchParams({
    client_id: process.env.ADOBE_CLIENT_ID,
    scope: SCOPES.replace(/,/g, ' '),
    response_type: 'code',
    redirect_uri: `${appUrl}/auth/callback`
  });
  return `${ADOBE_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: process.env.ADOBE_CLIENT_ID,
    client_secret: process.env.ADOBE_CLIENT_SECRET,
    code,
    redirect_uri: `${appUrl}/auth/callback`
  });

  const response = await axios.post(ADOBE_IMS_URL, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  const { access_token, refresh_token, expires_in } = response.data;

  writeTokenFile({ refresh_token, updated_at: new Date().toISOString() });

  cachedToken = access_token;
  tokenExpiry = Date.now() + (expires_in - 300) * 1000;

  return { access_token, refresh_token };
}

async function getAccessToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const tokenData = readTokenFile();
  if (!tokenData || !tokenData.refresh_token) {
    throw new Error('NO_REFRESH_TOKEN');
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.ADOBE_CLIENT_ID,
    client_secret: process.env.ADOBE_CLIENT_SECRET,
    refresh_token: tokenData.refresh_token
  });

  const response = await axios.post(ADOBE_IMS_URL, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  cachedToken = response.data.access_token;
  tokenExpiry = Date.now() + (response.data.expires_in - 300) * 1000;

  if (response.data.refresh_token) {
    writeTokenFile({ refresh_token: response.data.refresh_token, updated_at: new Date().toISOString() });
  }

  return cachedToken;
}

function apiHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

// ---- Frame.io v4 API ----

function accountBase() {
  return `${FRAMEIO_API}/accounts/${process.env.FRAMEIO_ACCOUNT_ID}`;
}

async function listClients() {
  const token = await getAccessToken();
  const headers = apiHeaders(token);

  // First get all workspaces for this account
  const wsRes = await axios.get(`${accountBase()}/workspaces`, { headers });
  const workspaces = wsRes.data.data || [];

  // Then get projects from all workspaces
  const allProjects = [];
  for (const ws of workspaces) {
    const projRes = await axios.get(
      `${accountBase()}/workspaces/${ws.id}/projects`,
      { headers }
    );
    const projects = projRes.data.data || [];
    allProjects.push(...projects.map(p => ({ id: p.id, name: p.name, root_folder_id: p.root_folder_id })));
  }

  return allProjects;
}

async function getProjectRootFolderId(projectId) {
  const token = await getAccessToken();
  const res = await axios.get(`${accountBase()}/projects/${projectId}`, {
    headers: apiHeaders(token)
  });
  return res.data.data ? res.data.data.root_folder_id : res.data.root_folder_id;
}

const WEEK_REGEX = /^S\d{2}$/i;
const ALLOWED_SPECIAL = ['youtube'];
const IGNORED_FOLDERS = ['archive semaine'];

function isAllowedFolder(name) {
  if (IGNORED_FOLDERS.includes(name.toLowerCase())) return false;
  if (WEEK_REGEX.test(name)) return true;
  if (ALLOWED_SPECIAL.includes(name.toLowerCase())) return true;
  return false;
}

async function listProjectFolders(projectId) {
  const token = await getAccessToken();
  const headers = apiHeaders(token);
  const rootFolderId = await getProjectRootFolderId(projectId);

  const res = await axios.get(`${accountBase()}/folders/${rootFolderId}/folders`, {
    headers
  });

  const items = res.data.data || [];
  return items
    .filter(item => isAllowedFolder(item.name))
    .map(f => ({ id: f.id, name: f.name }));
}

async function findOrCreateFolder(headers, parentId, name) {
  // List existing sub-folders
  const listRes = await axios.get(`${accountBase()}/folders/${parentId}/folders`, {
    headers
  });

  const items = listRes.data.data || [];
  const existing = items.find(
    item => item.name.toLowerCase() === name.toLowerCase()
  );

  if (existing) return existing;

  // Create new folder
  const createRes = await axios.post(`${accountBase()}/folders/${parentId}/folders`, {
    data: { name }
  }, { headers });

  return createRes.data.data || createRes.data;
}

async function uploadFile(filePath, fileName, fileSize, mimeType, projectId, weekFolder) {
  const token = await getAccessToken();
  const headers = apiHeaders(token);
  const rootFolderId = await getProjectRootFolderId(projectId);

  // Find or create the week folder
  const folder = await findOrCreateFolder(headers, rootFolderId, weekFolder);

  // Create file asset via local_upload endpoint (returns upload URLs)
  const assetRes = await axios.post(
    `${accountBase()}/folders/${folder.id}/files/local_upload`,
    { data: { name: fileName, file_size: fileSize } },
    { headers }
  );

  const asset = assetRes.data.data || assetRes.data;
  const uploadUrls = asset.upload_urls;

  if (!uploadUrls || uploadUrls.length === 0) {
    throw new Error('No upload URLs returned from Frame.io');
  }

  for (const part of uploadUrls) {
    const url = typeof part === 'string' ? part : part.url;
    const partSize = typeof part === 'string' ? fileSize : part.size;
    const start = typeof part === 'string' ? 0 : (uploadUrls.indexOf(part) * partSize);
    const end = Math.min(start + partSize, fileSize);
    const chunk = fs.createReadStream(filePath, { start, end: end - 1 });

    await axios.put(url, chunk, {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': end - start,
        'x-amz-acl': 'private'
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });
  }

  return {
    id: asset.id,
    name: asset.name,
    link: asset.view_url || `https://app.frame.io/player/${asset.id}`
  };
}

module.exports = {
  getAccessToken,
  getAuthorizeUrl,
  exchangeCodeForTokens,
  hasRefreshToken,
  listClients,
  listProjectFolders,
  uploadFile
};
