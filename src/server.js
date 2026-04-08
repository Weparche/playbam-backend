import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = dirname(__dirname);
const dataDir = join(rootDir, "data");
const dbPath = join(dataDir, "playbam.sqlite");

mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS host_users (
    id TEXT PRIMARY KEY,
    auth_token_hash TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY,
    host_user_id TEXT NOT NULL,
    share_token TEXT NOT NULL UNIQUE,
    public_slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    celebrant_name TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    location TEXT NOT NULL,
    message TEXT,
    cover_image TEXT,
    theme TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (host_user_id) REFERENCES host_users(id)
  );

  CREATE TABLE IF NOT EXISTS family_profiles (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    parent_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS family_children (
    id TEXT PRIMARY KEY,
    family_profile_id TEXT NOT NULL,
    name TEXT NOT NULL,
    age INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (family_profile_id) REFERENCES family_profiles(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS invitation_membership_requests (
    id TEXT PRIMARY KEY,
    invitation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TEXT NOT NULL,
    reviewed_at TEXT,
    reviewed_by_user_id TEXT,
    FOREIGN KEY (invitation_id) REFERENCES invitations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS invitation_membership_request_children (
    id TEXT PRIMARY KEY,
    membership_request_id TEXT NOT NULL,
    child_id TEXT NOT NULL,
    FOREIGN KEY (membership_request_id) REFERENCES invitation_membership_requests(id) ON DELETE CASCADE,
    FOREIGN KEY (child_id) REFERENCES family_children(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS invitation_rsvps (
    id TEXT PRIMARY KEY,
    invitation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('going', 'not_going', 'maybe')),
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (invitation_id, user_id),
    FOREIGN KEY (invitation_id) REFERENCES invitations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS invitation_wishlist_items (
    id TEXT PRIMARY KEY,
    invitation_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    url TEXT,
    price_label TEXT,
    image_url TEXT,
    priority_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (invitation_id) REFERENCES invitations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS invitation_gift_reservations (
    id TEXT PRIMARY KEY,
    invitation_id TEXT NOT NULL,
    wishlist_item_id TEXT NOT NULL,
    reserved_by_user_id TEXT NOT NULL,
    reserved_for_child_name TEXT,
    note TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'cancelled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (invitation_id) REFERENCES invitations(id) ON DELETE CASCADE,
    FOREIGN KEY (wishlist_item_id) REFERENCES invitation_wishlist_items(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_family_children_profile_id
    ON family_children (family_profile_id);
  CREATE INDEX IF NOT EXISTS idx_membership_requests_invitation_id
    ON invitation_membership_requests (invitation_id);
  CREATE INDEX IF NOT EXISTS idx_membership_requests_user_id
    ON invitation_membership_requests (user_id);
  CREATE INDEX IF NOT EXISTS idx_membership_request_children_request_id
    ON invitation_membership_request_children (membership_request_id);
  CREATE INDEX IF NOT EXISTS idx_invitation_rsvps_invitation_id
    ON invitation_rsvps (invitation_id);
  CREATE INDEX IF NOT EXISTS idx_invitation_wishlist_items_invitation_id
    ON invitation_wishlist_items (invitation_id);
  CREATE INDEX IF NOT EXISTS idx_gift_reservations_invitation_id
    ON invitation_gift_reservations (invitation_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_reservations_active_item
    ON invitation_gift_reservations (wishlist_item_id)
    WHERE status = 'active';
`);

function ensureColumnExists(tableName, columnName, columnDefinition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
}

ensureColumnExists("invitation_wishlist_items", "added_by_user_id", "TEXT");
ensureColumnExists("invitation_wishlist_items", "added_for_child_name", "TEXT");

const DEFAULT_HOST_TOKEN = process.env.PLAYBAM_HOST_AUTH_TOKEN ?? "playbam-dev-host-token";
const HOST_USER_ID = "host-demo-ana";
const HOST_EMAIL = "ana@playbam.hr";
const HOST_NAME = "Ana Horvat";
const WEB_BASE_URL = (process.env.PLAYBAM_WEB_BASE_URL ?? "http://localhost:5173").replace(/\/$/, "");
const PORT = Number(process.env.PORT ?? "4000");

function nowIso() {
  return new Date().toISOString();
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function randomId(prefix) {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

function createShareToken() {
  return randomBytes(24).toString("base64url");
}

function createWebShareUrl(token) {
  return `${WEB_BASE_URL}/pozivnica/${token}`;
}

function getInvitationPublicSlug(invitation) {
  return invitation.public_slug;
}

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Playbam-User-Email, X-Playbam-User-Name",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  });
  res.end(JSON.stringify(payload));
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization ?? "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }
  return token;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function readJsonBody(req) {
  const rawBody = await readBody(req);
  return rawBody ? JSON.parse(rawBody) : {};
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function displayNameFromEmail(email) {
  const localPart = email.split("@")[0] ?? "Korisnik";
  const parts = localPart.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) {
    return "Playbam korisnik";
  }

  return parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getInteger(value) {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }
  return null;
}

function assertNonEmptyString(value, fieldName) {
  const trimmed = getString(value);
  if (!trimmed) {
    return `${fieldName} is required`;
  }
  return null;
}

function validateCreatePayload(payload) {
  const requiredStringFields = ["title", "celebrantName", "date", "time", "location"];

  for (const field of requiredStringFields) {
    const error = assertNonEmptyString(payload[field], field);
    if (error) {
      return error;
    }
  }

  if (payload.message != null && typeof payload.message !== "string") {
    return "message must be a string";
  }
  if (payload.coverImage != null && typeof payload.coverImage !== "string") {
    return "coverImage must be a string";
  }
  if (payload.theme != null && typeof payload.theme !== "string") {
    return "theme must be a string";
  }

  return null;
}

function validateFamilyProfilePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { error: "Invalid family profile payload" };
  }

  const parentName = getString(payload.parentName);
  if (!parentName) {
    return { error: "parentName is required" };
  }

  if (!Array.isArray(payload.children) || payload.children.length === 0) {
    return { error: "children must contain at least one child" };
  }

  const children = [];
  for (const child of payload.children) {
    const name = getString(child?.name);
    const age = getInteger(child?.age);
    const childId = getString(child?.id) || null;

    if (!name) {
      return { error: "child.name is required" };
    }
    if (age == null || age < 1 || age > 18) {
      return { error: "child.age must be an integer between 1 and 18" };
    }

    children.push({ id: childId, name, age });
  }

  return { value: { parentName, children } };
}

function validateMembershipRequestPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { error: "Invalid membership request payload" };
  }

  if (!Array.isArray(payload.childIds) || payload.childIds.length === 0) {
    return { error: "childIds must contain at least one child id" };
  }

  const childIds = [...new Set(payload.childIds.map((value) => getString(value)).filter(Boolean))];
  if (childIds.length === 0) {
    return { error: "childIds must contain at least one child id" };
  }

  return { value: { childIds } };
}

function validateRsvpPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { error: "Invalid RSVP payload" };
  }

  const status = getString(payload.status);
  if (!["going", "not_going", "maybe"].includes(status)) {
    return { error: "status must be one of: going, not_going, maybe" };
  }

  const note = getString(payload.note) || null;
  return { value: { status, note } };
}

function validateWishlistItemPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { error: "Invalid wishlist item payload" };
  }

  const title = getString(payload.title);
  if (!title) {
    return { error: "title is required" };
  }

  const priorityOrderRaw = payload.priorityOrder ?? 0;
  const priorityOrder = getInteger(priorityOrderRaw);
  if (priorityOrder == null || priorityOrder < 0) {
    return { error: "priorityOrder must be an integer greater than or equal to 0" };
  }

  const isActive = payload.isActive == null ? true : Boolean(payload.isActive);

  return {
    value: {
      title,
      description: getString(payload.description) || null,
      url: getString(payload.url) || null,
      priceLabel: getString(payload.priceLabel) || null,
      imageUrl: getString(payload.imageUrl) || null,
      priorityOrder,
      isActive,
    },
  };
}

function validateGiftReservationPayload(payload) {
  if (payload == null) {
    return { value: { reservedForChildName: null, note: null } };
  }

  if (typeof payload !== "object") {
    return { error: "Invalid gift reservation payload" };
  }

  return {
    value: {
      reservedForChildName: getString(payload.reservedForChildName) || null,
      note: getString(payload.note) || null,
    },
  };
}

function mapInvitationRowToPublic(row) {
  const publicSlug = getInvitationPublicSlug(row);

  return {
    id: row.id,
    shareToken: row.share_token,
    publicSlug,
    title: row.title,
    celebrantName: row.celebrant_name,
    date: row.date,
    time: row.time,
    location: row.location,
    message: row.message,
    coverImage: row.cover_image,
    theme: row.theme,
    webShareUrl: createWebShareUrl(publicSlug),
  };
}
function getHostUserByToken(token) {
  if (!token) return null;
  return (
    db
      .prepare("SELECT id, email, display_name, created_at FROM host_users WHERE auth_token_hash = ?")
      .get(hashToken(token)) ?? null
  );
}

function getTemporaryIdentityHeaders(req) {
  const email = normalizeEmail(req.headers["x-playbam-user-email"]);
  const rawName = getString(req.headers["x-playbam-user-name"]);

  let displayName = rawName;
  try {
    displayName = decodeURIComponent(rawName);
  } catch {
    // already plain text
  }

  if (!email) {
    return null;
  }

  return {
    email,
    displayName: displayName || displayNameFromEmail(email),
  };
}

function upsertAppUser(email, displayName) {
  const existing = db.prepare("SELECT id, email, display_name, created_at, updated_at FROM app_users WHERE email = ?").get(email);
  const timestamp = nowIso();

  if (existing) {
    const nextDisplayName = displayName || existing.display_name;
    db.prepare("UPDATE app_users SET display_name = ?, updated_at = ? WHERE id = ?").run(
      nextDisplayName,
      timestamp,
      existing.id,
    );
    return {
      id: existing.id,
      email: existing.email,
      displayName: nextDisplayName,
      createdAt: existing.created_at,
      updatedAt: timestamp,
    };
  }

  const userId = randomId("usr");
  db.prepare(
    `
      INSERT INTO app_users (id, email, display_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `,
  ).run(userId, email, displayName, timestamp, timestamp);

  return {
    id: userId,
    email,
    displayName,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function getUserSummaryById(userId) {
  const host = db.prepare("SELECT id, email, display_name FROM host_users WHERE id = ?").get(userId);
  if (host) {
    return {
      id: host.id,
      email: host.email,
      displayName: host.display_name,
      kind: "host",
    };
  }

  const appUser = db.prepare("SELECT id, email, display_name FROM app_users WHERE id = ?").get(userId);
  if (!appUser) {
    return null;
  }

  return {
    id: appUser.id,
    email: appUser.email,
    displayName: appUser.display_name,
    kind: "app_user",
  };
}

function resolveCurrentUser(req) {
  const hostUser = getHostUserByToken(getBearerToken(req));
  if (hostUser) {
    return {
      id: hostUser.id,
      email: hostUser.email,
      displayName: hostUser.display_name,
      authType: "host_token",
      isHostIdentity: true,
    };
  }

  const temporaryIdentity = getTemporaryIdentityHeaders(req);
  if (!temporaryIdentity) {
    return null;
  }

  // TODO(auth): replace this header-based identity bridge with real session/auth middleware.
  const appUser = upsertAppUser(temporaryIdentity.email, temporaryIdentity.displayName);
  return {
    id: appUser.id,
    email: appUser.email,
    displayName: appUser.displayName,
    authType: "temporary_header_identity",
    isHostIdentity: false,
  };
}

function findInvitationByToken(token) {
  return (
    db
      .prepare(
        `
          SELECT id, host_user_id, share_token, public_slug, title, celebrant_name, date, time, location, message, cover_image, theme, created_at, updated_at
          FROM invitations
          WHERE share_token = ? OR public_slug = ?
        `,
      )
      .get(token, token) ?? null
  );
}

function findInvitationById(invitationId) {
  return (
    db
      .prepare(
        `
          SELECT id, host_user_id, share_token, public_slug, title, celebrant_name, date, time, location, message, cover_image, theme, created_at, updated_at
          FROM invitations
          WHERE id = ?
        `,
      )
      .get(invitationId) ?? null
  );
}

function getFamilyProfileWithChildren(userId) {
  const profile = db
    .prepare(
      `
        SELECT id, user_id, parent_name, created_at, updated_at
        FROM family_profiles
        WHERE user_id = ?
      `,
    )
    .get(userId);

  if (!profile) {
    return null;
  }

  const children = db
    .prepare(
      `
        SELECT id, family_profile_id, name, age, created_at, updated_at
        FROM family_children
        WHERE family_profile_id = ?
        ORDER BY created_at ASC
      `,
    )
    .all(profile.id);

  return { profile, children };
}

function serializeFamilyProfile(record) {
  if (!record) {
    return { profile: null, children: [] };
  }

  return {
    profile: {
      id: record.profile.id,
      userId: record.profile.user_id,
      parentName: record.profile.parent_name,
      createdAt: record.profile.created_at,
      updatedAt: record.profile.updated_at,
    },
    children: record.children.map((child) => ({
      id: child.id,
      familyProfileId: child.family_profile_id,
      name: child.name,
      age: child.age,
      createdAt: child.created_at,
      updatedAt: child.updated_at,
    })),
  };
}

function replaceFamilyChildren(familyProfileId, children) {
  db.prepare("DELETE FROM family_children WHERE family_profile_id = ?").run(familyProfileId);
  const insertChild = db.prepare(
    `
      INSERT INTO family_children (id, family_profile_id, name, age, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
  );

  for (const child of children) {
    const timestamp = nowIso();
    insertChild.run(child.id || randomId("child"), familyProfileId, child.name, child.age, timestamp, timestamp);
  }
}

function createFamilyProfile(userId, payload) {
  const timestamp = nowIso();
  const familyProfileId = randomId("family");

  db.prepare(
    `
      INSERT INTO family_profiles (id, user_id, parent_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `,
  ).run(familyProfileId, userId, payload.parentName, timestamp, timestamp);

  replaceFamilyChildren(familyProfileId, payload.children);
  return getFamilyProfileWithChildren(userId);
}

function updateFamilyProfile(existingProfile, payload) {
  const timestamp = nowIso();
  db.prepare("UPDATE family_profiles SET parent_name = ?, updated_at = ? WHERE id = ?").run(
    payload.parentName,
    timestamp,
    existingProfile.profile.id,
  );

  replaceFamilyChildren(existingProfile.profile.id, payload.children);
  return getFamilyProfileWithChildren(existingProfile.profile.user_id);
}

function getMembershipRequestById(requestId) {
  return (
    db
      .prepare(
        `
          SELECT id, invitation_id, user_id, status, created_at, reviewed_at, reviewed_by_user_id
          FROM invitation_membership_requests
          WHERE id = ?
        `,
      )
      .get(requestId) ?? null
  );
}

function getMembershipRequestForUser(invitationId, userId) {
  return (
    db
      .prepare(
        `
          SELECT id, invitation_id, user_id, status, created_at, reviewed_at, reviewed_by_user_id
          FROM invitation_membership_requests
          WHERE invitation_id = ? AND user_id = ?
          ORDER BY created_at DESC
          LIMIT 1
        `,
      )
      .get(invitationId, userId) ?? null
  );
}

function listMembershipRequestChildren(requestId) {
  return db
    .prepare(
      `
        SELECT c.id, c.family_profile_id, c.name, c.age, c.created_at, c.updated_at
        FROM invitation_membership_request_children mrc
        INNER JOIN family_children c ON c.id = mrc.child_id
        WHERE mrc.membership_request_id = ?
        ORDER BY c.created_at ASC
      `,
    )
    .all(requestId);
}
function serializeMembershipRequest(request) {
  if (!request) {
    return null;
  }

  const user = getUserSummaryById(request.user_id);
  const familyProfile = getFamilyProfileWithChildren(request.user_id);
  const rsvp = getRsvpForUser(request.invitation_id, request.user_id);
  const children = listMembershipRequestChildren(request.id).map((child) => ({
    id: child.id,
    familyProfileId: child.family_profile_id,
    name: child.name,
    age: child.age,
    createdAt: child.created_at,
    updatedAt: child.updated_at,
  }));

  return {
    id: request.id,
    invitationId: request.invitation_id,
    userId: request.user_id,
    status: request.status,
    createdAt: request.created_at,
    reviewedAt: request.reviewed_at,
    reviewedByUserId: request.reviewed_by_user_id,
    user,
    familyProfile: familyProfile
      ? {
          id: familyProfile.profile.id,
          parentName: familyProfile.profile.parent_name,
        }
      : null,
    rsvp: rsvp
      ? {
          status: rsvp.status,
          note: rsvp.note,
          updatedAt: rsvp.updated_at,
        }
      : null,
    children,
  };
}

function listMembershipRequestsForInvitation(invitationId) {
  const rows = db
    .prepare(
      `
        SELECT id, invitation_id, user_id, status, created_at, reviewed_at, reviewed_by_user_id
        FROM invitation_membership_requests
        WHERE invitation_id = ?
        ORDER BY
          CASE status
            WHEN 'pending' THEN 0
            WHEN 'approved' THEN 1
            ELSE 2
          END,
          created_at ASC
      `,
    )
    .all(invitationId);

  return rows.map((row) => serializeMembershipRequest(row));
}

function getInvitationHostSummary(invitationId) {
  const summary = db
    .prepare(
      `
        SELECT
          (SELECT COUNT(*)
           FROM invitation_membership_requests
           WHERE invitation_id = ?) AS request_count,
          (SELECT COUNT(*)
           FROM invitation_membership_requests
           WHERE invitation_id = ? AND status = 'approved') AS approved_count,
          (SELECT COUNT(*)
           FROM invitation_membership_requests
           WHERE invitation_id = ? AND status = 'pending') AS pending_count,
          (SELECT COUNT(*)
           FROM invitation_membership_requests
           WHERE invitation_id = ? AND status = 'rejected') AS rejected_count,
          (SELECT COUNT(DISTINCT r.user_id)
           FROM invitation_rsvps r
           INNER JOIN invitation_membership_requests mr
             ON mr.invitation_id = r.invitation_id
            AND mr.user_id = r.user_id
           WHERE r.invitation_id = ?
             AND mr.status = 'approved') AS response_count,
          (SELECT COUNT(DISTINCT r.user_id)
           FROM invitation_rsvps r
           INNER JOIN invitation_membership_requests mr
             ON mr.invitation_id = r.invitation_id
            AND mr.user_id = r.user_id
           WHERE r.invitation_id = ?
             AND mr.status = 'approved'
             AND r.status = 'going') AS attending_count
      `,
    )
    .get(
      invitationId,
      invitationId,
      invitationId,
      invitationId,
      invitationId,
      invitationId,
    );

  return {
    invitationId,
    requestCount: summary.request_count,
    approvedCount: summary.approved_count,
    pendingCount: summary.pending_count,
    rejectedCount: summary.rejected_count,
    responseCount: summary.response_count,
    attendingCount: summary.attending_count,
  };
}

function listWishlistItemsForInvitation(invitationId, includeInactive = true) {
  const whereClause = includeInactive ? "" : "AND is_active = 1";
  return db
    .prepare(
      `
        SELECT id, invitation_id, title, description, url, price_label, image_url, priority_order, is_active, added_by_user_id, added_for_child_name, created_at, updated_at
        FROM invitation_wishlist_items
        WHERE invitation_id = ? ${whereClause}
        ORDER BY priority_order ASC, created_at ASC
      `,
    )
    .all(invitationId);
}

function getWishlistItemById(itemId) {
  return (
    db
      .prepare(
        `
          SELECT id, invitation_id, title, description, url, price_label, image_url, priority_order, is_active, added_by_user_id, added_for_child_name, created_at, updated_at
          FROM invitation_wishlist_items
          WHERE id = ?
        `,
      )
      .get(itemId) ?? null
  );
}

function getWishlistItemForInvitation(invitationId, itemId) {
  const item = getWishlistItemById(itemId);
  if (!item || item.invitation_id !== invitationId) {
    return null;
  }
  return item;
}

function getActiveGiftReservationForItem(itemId) {
  return (
    db
      .prepare(
        `
          SELECT id, invitation_id, wishlist_item_id, reserved_by_user_id, reserved_for_child_name, note, status, created_at, updated_at
          FROM invitation_gift_reservations
          WHERE wishlist_item_id = ? AND status = 'active'
          ORDER BY created_at DESC
          LIMIT 1
        `,
      )
      .get(itemId) ?? null
  );
}

function serializeWishlistReservation(reservation, currentUser, isHost) {
  if (!reservation) {
    return { status: "available" };
  }

  const reservedBy = getUserSummaryById(reservation.reserved_by_user_id);
  const reservationPayload = {
    reservedByUserId: reservation.reserved_by_user_id,
    reservedByName: reservedBy?.displayName ?? "Nepoznat korisnik",
    reservedForChildName: reservation.reserved_for_child_name,
    note: reservation.note,
    createdAt: reservation.created_at,
    updatedAt: reservation.updated_at,
  };

  if (isHost) {
    return {
      status: reservation.status,
      ...reservationPayload,
    };
  }

  if (currentUser && reservation.reserved_by_user_id === currentUser.id) {
    return {
      status: "reserved_by_you",
      ...reservationPayload,
    };
  }

  return {
    status: "reserved",
    ...reservationPayload,
  };
}

function serializeWishlistItem(item, reservation, currentUser, isHost) {
  const addedBy = item.added_by_user_id ? getUserSummaryById(item.added_by_user_id) : null;
  return {
    id: item.id,
    invitationId: item.invitation_id,
    title: item.title,
    description: item.description,
    url: item.url,
    priceLabel: item.price_label,
    imageUrl: item.image_url,
    priorityOrder: item.priority_order,
    isActive: Boolean(item.is_active),
    addedByUserId: item.added_by_user_id ?? null,
    addedByName: addedBy?.displayName ?? null,
    addedForChildName: item.added_for_child_name ?? null,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    reservation: serializeWishlistReservation(reservation, currentUser, isHost),
  };
}

function serializeWishlistItems(invitationId, currentUser) {
  const isHost = Boolean(currentUser && currentUser.id === findInvitationById(invitationId)?.host_user_id);
  const items = listWishlistItemsForInvitation(invitationId, isHost);
  return items.map((item) => serializeWishlistItem(item, getActiveGiftReservationForItem(item.id), currentUser, isHost));
}

function getWishlistItemAddedForChildName(invitationId, currentUser) {
  if (!currentUser) {
    return null;
  }

  const membershipRequest = getMembershipRequestForUser(invitationId, currentUser.id);
  if (membershipRequest?.status === "approved") {
    const approvedChild = listMembershipRequestChildren(membershipRequest.id)[0];
    if (approvedChild?.name) {
      return approvedChild.name;
    }
  }

  const familyProfile = getFamilyProfileWithChildren(currentUser.id);
  return familyProfile?.children?.[0]?.name ?? null;
}

function createWishlistItem(invitationId, payload, currentUser = null) {
  const itemId = randomId("wish");
  const timestamp = nowIso();
  const addedForChildName = getWishlistItemAddedForChildName(invitationId, currentUser);

  db.prepare(
    `
      INSERT INTO invitation_wishlist_items (
        id, invitation_id, title, description, url, price_label, image_url, priority_order, is_active, added_by_user_id, added_for_child_name, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    itemId,
    invitationId,
    payload.title,
    payload.description,
    payload.url,
    payload.priceLabel,
    payload.imageUrl,
    payload.priorityOrder,
    payload.isActive ? 1 : 0,
    currentUser?.id ?? null,
    addedForChildName,
    timestamp,
    timestamp,
  );

  return getWishlistItemById(itemId);
}

function updateWishlistItem(item, payload) {
  const timestamp = nowIso();
  db.prepare(
    `
      UPDATE invitation_wishlist_items
      SET title = ?, description = ?, url = ?, price_label = ?, image_url = ?, priority_order = ?, is_active = ?, updated_at = ?
      WHERE id = ?
    `,
  ).run(
    payload.title,
    payload.description,
    payload.url,
    payload.priceLabel,
    payload.imageUrl,
    payload.priorityOrder,
    payload.isActive ? 1 : 0,
    timestamp,
    item.id,
  );

  return getWishlistItemById(item.id);
}

function deleteWishlistItem(itemId) {
  db.prepare("DELETE FROM invitation_wishlist_items WHERE id = ?").run(itemId);
}

function deleteWishlistItemWithReservation(itemId) {
  const activeReservation = getActiveGiftReservationForItem(itemId);
  if (activeReservation) {
    cancelGiftReservation(activeReservation);
  }

  deleteWishlistItem(itemId);
}

function createGiftReservation(invitationId, itemId, userId, payload) {
  const reservationId = randomId("gift");
  const timestamp = nowIso();
  db.prepare(
    `
      INSERT INTO invitation_gift_reservations (
        id, invitation_id, wishlist_item_id, reserved_by_user_id, reserved_for_child_name, note, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `,
  ).run(
    reservationId,
    invitationId,
    itemId,
    userId,
    payload.reservedForChildName,
    payload.note,
    timestamp,
    timestamp,
  );

  return getActiveGiftReservationForItem(itemId);
}

function cancelGiftReservation(reservation) {
  const timestamp = nowIso();
  db.prepare(
    `
      UPDATE invitation_gift_reservations
      SET status = 'cancelled', updated_at = ?
      WHERE id = ?
    `,
  ).run(timestamp, reservation.id);
}

function requireApprovedInvitationAccess(res, invitation, currentUser) {
  if (!currentUser) {
    json(res, 401, { error: "Authenticated user required" });
    return false;
  }

  if (invitation.host_user_id === currentUser.id) {
    return true;
  }

  if (getMembershipStatusForUser(invitation, currentUser.id) !== "approved") {
    json(res, 403, { error: "Approved invitation membership is required" });
    return false;
  }

  return true;
}

function requireApprovedGuestWishlistAccess(res, invitation, currentUser) {
  if (!currentUser) {
    json(res, 401, { error: "Authenticated user required" });
    return false;
  }

  if (invitation.host_user_id === currentUser.id) {
    json(res, 403, { error: "Invitation host cannot reserve gifts" });
    return false;
  }

  if (getMembershipStatusForUser(invitation, currentUser.id) !== "approved") {
    json(res, 403, { error: "Approved invitation membership is required" });
    return false;
  }

  return true;
}

function createMembershipRequest(invitationId, userId, childIds) {
  const requestId = randomId("membership");
  const timestamp = nowIso();

  db.prepare(
    `
      INSERT INTO invitation_membership_requests (
        id, invitation_id, user_id, status, created_at, reviewed_at, reviewed_by_user_id
      )
      VALUES (?, ?, ?, 'pending', ?, NULL, NULL)
    `,
  ).run(requestId, invitationId, userId, timestamp);

  const insertMembershipChild = db.prepare(
    `
      INSERT INTO invitation_membership_request_children (id, membership_request_id, child_id)
      VALUES (?, ?, ?)
    `,
  );

  for (const childId of childIds) {
    insertMembershipChild.run(randomId("membership_child"), requestId, childId);
  }

  return getMembershipRequestById(requestId);
}

function reviewMembershipRequest(request, status, reviewerId) {
  const reviewedAt = nowIso();
  db.prepare(
    `
      UPDATE invitation_membership_requests
      SET status = ?, reviewed_at = ?, reviewed_by_user_id = ?
      WHERE id = ?
    `,
  ).run(status, reviewedAt, reviewerId, request.id);

  return getMembershipRequestById(request.id);
}

function getRsvpForUser(invitationId, userId) {
  return (
    db
      .prepare(
        `
          SELECT id, invitation_id, user_id, status, note, created_at, updated_at
          FROM invitation_rsvps
          WHERE invitation_id = ? AND user_id = ?
        `,
      )
      .get(invitationId, userId) ?? null
  );
}

function serializeRsvp(rsvp) {
  if (!rsvp) {
    return null;
  }

  return {
    id: rsvp.id,
    invitationId: rsvp.invitation_id,
    userId: rsvp.user_id,
    status: rsvp.status,
    note: rsvp.note,
    createdAt: rsvp.created_at,
    updatedAt: rsvp.updated_at,
  };
}

function upsertRsvp(invitationId, userId, payload) {
  const existing = getRsvpForUser(invitationId, userId);
  const timestamp = nowIso();

  if (existing) {
    db.prepare(
      `
        UPDATE invitation_rsvps
        SET status = ?, note = ?, updated_at = ?
        WHERE id = ?
      `,
    ).run(payload.status, payload.note, timestamp, existing.id);
    return getRsvpForUser(invitationId, userId);
  }

  const rsvpId = randomId("rsvp");
  db.prepare(
    `
      INSERT INTO invitation_rsvps (id, invitation_id, user_id, status, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(rsvpId, invitationId, userId, payload.status, payload.note, timestamp, timestamp);

  return getRsvpForUser(invitationId, userId);
}

function getMembershipStatusForUser(invitation, userId) {
  if (!userId) {
    return null;
  }
  if (invitation.host_user_id === userId) {
    return "approved";
  }

  return getMembershipRequestForUser(invitation.id, userId)?.status ?? null;
}

function getInvitationAccess(invitation, currentUser) {
  const loggedIn = Boolean(currentUser);
  const isHost = Boolean(currentUser && invitation.host_user_id === currentUser.id);
  const membershipStatus = currentUser ? getMembershipStatusForUser(invitation, currentUser.id) : null;
  const canAccessPrivateInvitation = Boolean(isHost || membershipStatus === "approved");

  return {
    invitationId: invitation.id,
    publicAccess: true,
    loggedIn,
    isHost,
    membershipStatus: isHost ? null : membershipStatus,
    canAccessPrivateInvitation,
    canViewWishlist: canAccessPrivateInvitation,
    canRsvp: Boolean(loggedIn && !isHost && membershipStatus === "approved"),
  };
}

function requireCurrentUser(req, res) {
  const currentUser = resolveCurrentUser(req);
  if (!currentUser) {
    json(res, 401, { error: "Authenticated user required" });
    return null;
  }
  return currentUser;
}

function requireInvitationById(res, invitationId) {
  const invitation = findInvitationById(invitationId);
  if (!invitation) {
    json(res, 404, { error: "Invitation not found" });
    return null;
  }
  return invitation;
}

function requireHostAccess(res, invitation, currentUser) {
  if (!currentUser || invitation.host_user_id !== currentUser.id) {
    json(res, 403, { error: "Invitation host access required" });
    return false;
  }
  return true;
}

function seedDefaultHostUser() {
  const existing = db.prepare("SELECT id FROM host_users WHERE id = ?").get(HOST_USER_ID);
  if (existing) {
    return;
  }

  db.prepare(
    `
      INSERT INTO host_users (id, auth_token_hash, email, display_name, created_at)
      VALUES (?, ?, ?, ?, ?)
    `,
  ).run(HOST_USER_ID, hashToken(DEFAULT_HOST_TOKEN), HOST_EMAIL, HOST_NAME, nowIso());
}

seedDefaultHostUser();

/** Demo pozivnica za web (/pozivnica/luka-istrazivaci) i /pozivnica-demo. */
function seedDemoInvitation() {
  const publicSlug = "luka-istrazivaci";
  const existing = db.prepare("SELECT id FROM invitations WHERE public_slug = ?").get(publicSlug);
  if (existing) {
    return;
  }

  const invitationId = "inv_demo_luka_istrazivaci";
  const shareToken = publicSlug;
  const timestamp = nowIso();

  db.prepare(
    `
      INSERT INTO invitations (
        id, host_user_id, share_token, public_slug, title, celebrant_name, date, time,
        location, message, cover_image, theme, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    invitationId,
    HOST_USER_ID,
    shareToken,
    publicSlug,
    "Luka istražuje svemir",
    "Luka",
    "2026-06-15",
    "15:00",
    "Happy Land, Lastovska 2, Zagreb",
    "Veselimo se druženju!",
    "baloni",
    "baloni",
    timestamp,
    timestamp,
  );
}

seedDemoInvitation();

const server = createServer(async (req, res) => {
  if (!req.url || !req.method) {
    json(res, 400, { error: "Invalid request" });
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Playbam-User-Email, X-Playbam-User-Name",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname;

  try {
    if (req.method === "POST" && pathname === "/api/invitations") {
      const hostUser = getHostUserByToken(getBearerToken(req));
      if (!hostUser) {
        json(res, 401, { error: "Authenticated host user required" });
        return;
      }

      const payload = await readJsonBody(req);
      const validationError = validateCreatePayload(payload);
      if (validationError) {
        json(res, 400, { error: validationError });
        return;
      }

      const invitationId = randomId("inv");
      const shareToken = createShareToken();
      const publicSlug = shareToken;
      const timestamp = nowIso();

      db.prepare(
        `
          INSERT INTO invitations (
            id, host_user_id, share_token, public_slug, title, celebrant_name, date, time,
            location, message, cover_image, theme, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        invitationId,
        hostUser.id,
        shareToken,
        publicSlug,
        getString(payload.title),
        getString(payload.celebrantName),
        getString(payload.date),
        getString(payload.time),
        getString(payload.location),
        getString(payload.message) || null,
        getString(payload.coverImage) || null,
        getString(payload.theme) || null,
        timestamp,
        timestamp,
      );

      json(res, 201, {
        id: invitationId,
        shareToken,
        publicSlug,
        webShareUrl: createWebShareUrl(publicSlug),
      });
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/api/public/invitations/")) {
      const token = decodeURIComponent(pathname.replace("/api/public/invitations/", ""));
      if (!token) {
        json(res, 400, { error: "Invitation token is required" });
        return;
      }

      const invitation = findInvitationByToken(token);
      if (!invitation) {
        json(res, 404, { error: "Invitation not found" });
        return;
      }

      json(res, 200, mapInvitationRowToPublic(invitation));
      return;
    }

    if (req.method === "GET" && pathname === "/api/me/family-profile") {
      const currentUser = requireCurrentUser(req, res);
      if (!currentUser) return;

      json(res, 200, serializeFamilyProfile(getFamilyProfileWithChildren(currentUser.id)));
      return;
    }

    if ((req.method === "POST" || req.method === "PUT") && pathname === "/api/me/family-profile") {
      const currentUser = requireCurrentUser(req, res);
      if (!currentUser) return;

      const parsed = validateFamilyProfilePayload(await readJsonBody(req));
      if (parsed.error) {
        json(res, 400, { error: parsed.error });
        return;
      }

      const existingProfile = getFamilyProfileWithChildren(currentUser.id);
      if (req.method === "POST" && existingProfile) {
        json(res, 409, { error: "Family profile already exists" });
        return;
      }
      if (req.method === "PUT" && !existingProfile) {
        json(res, 404, { error: "Family profile not found" });
        return;
      }

      const nextProfile = req.method === "POST"
        ? createFamilyProfile(currentUser.id, parsed.value)
        : updateFamilyProfile(existingProfile, parsed.value);

      json(res, req.method === "POST" ? 201 : 200, serializeFamilyProfile(nextProfile));
      return;
    }

    const membershipRequestMeMatch = pathname.match(/^\/api\/invitations\/([^/]+)\/membership-request\/me$/);
    if (req.method === "GET" && membershipRequestMeMatch) {
      const currentUser = requireCurrentUser(req, res);
      if (!currentUser) return;

      const invitation = requireInvitationById(res, decodeURIComponent(membershipRequestMeMatch[1]));
      if (!invitation) return;

      json(res, 200, { request: serializeMembershipRequest(getMembershipRequestForUser(invitation.id, currentUser.id)) });
      return;
    }

    const membershipRequestsMatch = pathname.match(/^\/api\/invitations\/([^/]+)\/membership-requests$/);
    if (membershipRequestsMatch && req.method === "POST") {
      const currentUser = requireCurrentUser(req, res);
      if (!currentUser) return;

      const invitation = requireInvitationById(res, decodeURIComponent(membershipRequestsMatch[1]));
      if (!invitation) return;
      if (invitation.host_user_id === currentUser.id) {
        json(res, 400, { error: "Invitation host cannot create a membership request" });
        return;
      }

      const familyProfile = getFamilyProfileWithChildren(currentUser.id);
      if (!familyProfile) {
        json(res, 400, { error: "Family profile is required before sending a membership request" });
        return;
      }

      const parsed = validateMembershipRequestPayload(await readJsonBody(req));
      if (parsed.error) {
        json(res, 400, { error: parsed.error });
        return;
      }

      const ownedChildIds = new Set(familyProfile.children.map((child) => child.id));
      const invalidChildId = parsed.value.childIds.find((childId) => !ownedChildIds.has(childId));
      if (invalidChildId) {
        json(res, 400, { error: "All childIds must belong to the current user's family profile" });
        return;
      }

      const existingRequest = getMembershipRequestForUser(invitation.id, currentUser.id);
      if (existingRequest?.status === "pending") {
        json(res, 409, { error: "Pending membership request already exists for this invitation" });
        return;
      }
      if (existingRequest?.status === "approved") {
        json(res, 409, { error: "Membership access has already been approved for this invitation" });
        return;
      }

      const requestRecord = createMembershipRequest(invitation.id, currentUser.id, parsed.value.childIds);
      json(res, 201, { request: serializeMembershipRequest(requestRecord) });
      return;
    }

    if (membershipRequestsMatch && req.method === "GET") {
      const currentUser = requireCurrentUser(req, res);
      if (!currentUser) return;

      const invitation = requireInvitationById(res, decodeURIComponent(membershipRequestsMatch[1]));
      if (!invitation) return;
      if (!requireHostAccess(res, invitation, currentUser)) return;

      json(res, 200, { requests: listMembershipRequestsForInvitation(invitation.id) });
      return;
    }

    const hostSummaryMatch = pathname.match(/^\/api\/invitations\/([^/]+)\/host-summary$/);
    if (hostSummaryMatch && req.method === "GET") {
      const currentUser = requireCurrentUser(req, res);
      if (!currentUser) return;

      const invitation = requireInvitationById(res, decodeURIComponent(hostSummaryMatch[1]));
      if (!invitation) return;
      if (!requireHostAccess(res, invitation, currentUser)) return;

      json(res, 200, getInvitationHostSummary(invitation.id));
      return;
    }

    const wishlistMatch = pathname.match(/^\/api\/invitations\/([^/]+)\/wishlist$/);
    if (wishlistMatch && req.method === "GET") {
      const currentUser = requireCurrentUser(req, res);
      if (!currentUser) return;

      const invitation = requireInvitationById(res, decodeURIComponent(wishlistMatch[1]));
      if (!invitation) return;
      if (!requireApprovedInvitationAccess(res, invitation, currentUser)) return;

      json(res, 200, { items: serializeWishlistItems(invitation.id, currentUser) });
      return;
    }

    if (wishlistMatch && req.method === "POST") {
      const currentUser = requireCurrentUser(req, res);
      if (!currentUser) return;

      const invitation = requireInvitationById(res, decodeURIComponent(wishlistMatch[1]));
      if (!invitation) return;
      const isHost = invitation.host_user_id === currentUser.id;
      if (!isHost && !requireApprovedGuestWishlistAccess(res, invitation, currentUser)) return;

      const parsed = validateWishlistItemPayload(await readJsonBody(req));
      if (parsed.error) {
        json(res, 400, { error: parsed.error });
        return;
      }

      const item = createWishlistItem(invitation.id, parsed.value, currentUser);
      let reservation = getActiveGiftReservationForItem(item.id);

      if (!isHost) {
        reservation = createGiftReservation(invitation.id, item.id, currentUser.id, {
          reservedForChildName: item.added_for_child_name ?? null,
          note: "Gost je dodao svoj poklon",
        });
      }

      json(res, 201, { item: serializeWishlistItem(item, reservation, currentUser, isHost) });
      return;
    }

    const wishlistItemMatch = pathname.match(/^\/api\/invitations\/([^/]+)\/wishlist\/([^/]+)$/);
    if (wishlistItemMatch && req.method === "PUT") {
      const currentUser = requireCurrentUser(req, res);
      if (!currentUser) return;

      const invitation = requireInvitationById(res, decodeURIComponent(wishlistItemMatch[1]));
      if (!invitation) return;
      if (!requireHostAccess(res, invitation, currentUser)) return;

      const item = getWishlistItemForInvitation(invitation.id, decodeURIComponent(wishlistItemMatch[2]));
      if (!item) {
        json(res, 404, { error: "Wishlist item not found" });
        return;
      }

      const parsed = validateWishlistItemPayload(await readJsonBody(req));
      if (parsed.error) {
        json(res, 400, { error: parsed.error });
        return;
      }

      const updated = updateWishlistItem(item, parsed.value);
      json(res, 200, { item: serializeWishlistItem(updated, getActiveGiftReservationForItem(updated.id), currentUser, true) });
      return;
    }

    if (wishlistItemMatch && req.method === "DELETE") {
      const currentUser = requireCurrentUser(req, res);
      if (!currentUser) return;

      const invitation = requireInvitationById(res, decodeURIComponent(wishlistItemMatch[1]));
      if (!invitation) return;

      const item = getWishlistItemForInvitation(invitation.id, decodeURIComponent(wishlistItemMatch[2]));
      if (!item) {
        json(res, 404, { error: "Wishlist item not found" });
        return;
      }

      const isHost = invitation.host_user_id === currentUser.id;
      const canDeleteOwnGuestItem = item.added_by_user_id === currentUser.id;

      if (!isHost && !canDeleteOwnGuestItem) {
        json(res, 403, { error: "Only the host or the guest who added this item can delete it" });
        return;
      }

      deleteWishlistItemWithReservation(item.id);
      json(res, 200, { deleted: true, itemId: item.id });
      return;
    }

    const reserveMatch = pathname.match(/^\/api\/invitations\/([^/]+)\/wishlist\/([^/]+)\/reserve$/);
    if (reserveMatch && req.method === "POST") {
      const currentUser = requireCurrentUser(req, res);
      if (!currentUser) return;

      const invitation = requireInvitationById(res, decodeURIComponent(reserveMatch[1]));
      if (!invitation) return;
      if (!requireApprovedGuestWishlistAccess(res, invitation, currentUser)) return;

      const item = getWishlistItemForInvitation(invitation.id, decodeURIComponent(reserveMatch[2]));
      if (!item) {
        json(res, 404, { error: "Wishlist item not found" });
        return;
      }
      if (!item.is_active) {
        json(res, 409, { error: "Wishlist item is not active" });
        return;
      }

      const parsed = validateGiftReservationPayload(await readJsonBody(req));
      if (parsed.error) {
        json(res, 400, { error: parsed.error });
        return;
      }

      const activeReservation = getActiveGiftReservationForItem(item.id);
      if (activeReservation) {
        if (activeReservation.reserved_by_user_id === currentUser.id) {
          json(res, 200, { item: serializeWishlistItem(item, activeReservation, currentUser, false) });
          return;
        }

        json(res, 409, { error: "Wishlist item is already reserved" });
        return;
      }

      try {
        const reservation = createGiftReservation(invitation.id, item.id, currentUser.id, parsed.value);
        json(res, 201, { item: serializeWishlistItem(item, reservation, currentUser, false) });
      } catch (error) {
        if (String(error?.message ?? error).includes("idx_gift_reservations_active_item")) {
          json(res, 409, { error: "Wishlist item is already reserved" });
          return;
        }
        throw error;
      }
      return;
    }

    const cancelReservationMatch = pathname.match(/^\/api\/invitations\/([^/]+)\/wishlist\/([^/]+)\/cancel-reservation$/);
    if (cancelReservationMatch && req.method === "POST") {
      const currentUser = requireCurrentUser(req, res);
      if (!currentUser) return;

      const invitation = requireInvitationById(res, decodeURIComponent(cancelReservationMatch[1]));
      if (!invitation) return;

      const item = getWishlistItemForInvitation(invitation.id, decodeURIComponent(cancelReservationMatch[2]));
      if (!item) {
        json(res, 404, { error: "Wishlist item not found" });
        return;
      }

      const reservation = getActiveGiftReservationForItem(item.id);
      if (!reservation) {
        json(res, 404, { error: "Active reservation not found" });
        return;
      }

      const isHost = invitation.host_user_id === currentUser.id;
      if (!isHost) {
        if (!requireApprovedGuestWishlistAccess(res, invitation, currentUser)) return;
        if (reservation.reserved_by_user_id !== currentUser.id) {
          json(res, 403, { error: "Only the reservation owner can cancel this reservation" });
          return;
        }
      }

      cancelGiftReservation(reservation);
      json(res, 200, { item: serializeWishlistItem(item, null, currentUser, isHost) });
      return;
    }

    const reviewMatch = pathname.match(/^\/api\/invitations\/([^/]+)\/membership-requests\/([^/]+)\/(approve|reject)$/);
    if (reviewMatch && req.method === "POST") {
      const currentUser = requireCurrentUser(req, res);
      if (!currentUser) return;

      const invitation = requireInvitationById(res, decodeURIComponent(reviewMatch[1]));
      if (!invitation) return;
      if (!requireHostAccess(res, invitation, currentUser)) return;

      const requestRecord = getMembershipRequestById(decodeURIComponent(reviewMatch[2]));
      if (!requestRecord || requestRecord.invitation_id !== invitation.id) {
        json(res, 404, { error: "Membership request not found" });
        return;
      }
      if (
        (reviewMatch[3] === "approve" && requestRecord.status !== "pending") ||
        (reviewMatch[3] === "reject" && requestRecord.status === "rejected")
      ) {
        json(res, 409, { error: "Membership request cannot be changed in the current state" });
        return;
      }

      const reviewed = reviewMembershipRequest(
        requestRecord,
        reviewMatch[3] === "approve" ? "approved" : "rejected",
        currentUser.id,
      );

      json(res, 200, { request: serializeMembershipRequest(reviewed) });
      return;
    }
    const rsvpMeMatch = pathname.match(/^\/api\/invitations\/([^/]+)\/rsvp\/me$/);
    if (rsvpMeMatch && req.method === "GET") {
      const currentUser = requireCurrentUser(req, res);
      if (!currentUser) return;

      const invitation = requireInvitationById(res, decodeURIComponent(rsvpMeMatch[1]));
      if (!invitation) return;

      json(res, 200, { rsvp: serializeRsvp(getRsvpForUser(invitation.id, currentUser.id)) });
      return;
    }

    const rsvpMatch = pathname.match(/^\/api\/invitations\/([^/]+)\/rsvp$/);
    if (rsvpMatch && req.method === "POST") {
      const currentUser = requireCurrentUser(req, res);
      if (!currentUser) return;

      const invitation = requireInvitationById(res, decodeURIComponent(rsvpMatch[1]));
      if (!invitation) return;
      if (invitation.host_user_id === currentUser.id) {
        json(res, 403, { error: "Invitation host cannot RSVP to their own invitation" });
        return;
      }

      const membershipStatus = getMembershipStatusForUser(invitation, currentUser.id);
      if (membershipStatus !== "approved") {
        json(res, 403, { error: "Approved invitation membership is required before RSVP" });
        return;
      }

      const parsed = validateRsvpPayload(await readJsonBody(req));
      if (parsed.error) {
        json(res, 400, { error: parsed.error });
        return;
      }

      json(res, 200, { rsvp: serializeRsvp(upsertRsvp(invitation.id, currentUser.id, parsed.value)) });
      return;
    }

    const accessMatch = pathname.match(/^\/api\/invitations\/([^/]+)\/access\/me$/);
    if (accessMatch && req.method === "GET") {
      const invitation = requireInvitationById(res, decodeURIComponent(accessMatch[1]));
      if (!invitation) return;

      json(res, 200, getInvitationAccess(invitation, resolveCurrentUser(req)));
      return;
    }

    if (req.method === "GET" && pathname === "/health") {
      json(res, 200, { ok: true });
      return;
    }

    json(res, 404, { error: "Not found" });
  } catch (error) {
    if (error instanceof SyntaxError) {
      json(res, 400, { error: "Invalid JSON body" });
      return;
    }

    console.error("Playbam backend request failed", error);
    json(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Playbam backend listening on http://localhost:${PORT}`);
  console.log(`Seed host token: ${DEFAULT_HOST_TOKEN}`);
  console.log("Temporary web identity headers: X-Playbam-User-Email, X-Playbam-User-Name");
});
