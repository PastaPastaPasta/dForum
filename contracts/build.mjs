#!/usr/bin/env node
/**
 * Generates contracts/generated/dforum.<mode>.json from the shared schema.
 *
 * Usage:
 *   node contracts/build.mjs --moderation none|team|network [--deployer <identityId>] [--out <dir>]
 *
 * The generated file is committed; CI checks that regeneration is clean.
 *
 * Modes:
 *   none    — no moderation block at all. Nothing removable or bannable at
 *             consensus, ever. Types drop every moderator-only field, index and
 *             moderatorAbilities. Owner mode: settings/categories/forums stay
 *             owner-only (creationRestrictionMode 1).
 *   team    — native moderation, appointed moderators (deployer team). The
 *             roster is edited later via a contract update by the contract
 *             owner.
 *   network — native moderation, elected (masternode-elected team) with an
 *             appointed interim set (the deployer team). Header note: this is
 *             testnet-only and contradicts the brief's non-elected default.
 *
 * All fields in the `required` list below are stored and indexed exactly once;
 * nothing here is speculative.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const MODERATION_MODES = ['none', 'team', 'network'];

const DEFAULT_ROSTER = []; // filled by --deployer for network mode when electing

// ---- field schemata --------------------------------------------------------
// "identifier" is the 32-byte identifier shorthand (the same value the chain
// stores for a 32-byte identifier reference).
const ID = { type: 'identifier' };

function string(minLength, maxLength, position, extra = {}) {
  return { type: 'string', minLength, maxLength, ...extra, position };
}
function int(minimum, maximum, position) {
  return { type: 'integer', minimum, ...(maximum === undefined ? {} : { maximum }), position };
}
function pos(position) { return { position }; }

const slug = (position) => string(1, 48, position, { pattern: '^[a-z0-9-]{1,48}$' });
const title = (position) => string(3, 80, position);

const FORUM_ID = {
  type: 'identifier',
  refersTo: { type: 'permanentDocument', documentType: 'forum' },
};
const CATEGORY_ID = {
  type: 'identifier',
  refersTo: { type: 'permanentDocument', documentType: 'category' },
};
const THREAD_ID = {
  type: 'identifier',
  refersTo: {
    type: 'moderatedDocument',
    documentType: 'thread',
    where: { forumId: 'forumId' },
  },
};
const FORUM_REF_REQUIRED = ['$createdAt', '$updatedAt', 'forumId', 'title'];

// ---- document types ----------------------------------------------------------

function forumSettingsType() {
  let positionCursor = 0;
  return {
    type: 'object',
    canBeDeleted: false,
    creationRestrictionMode: 1,
    documentsMutable: true,
    properties: {
      key: { ...string(1, 16, positionCursor++, { pattern: '^[a-z0-9-]{1,16}$' }) },
      name: string(1, 80, positionCursor++),
      tagline: string(0, 160, positionCursor++),
      description: string(0, 1000, positionCursor++),
      rules: string(0, 1000, positionCursor++, { maxBytes: 8192 }),
      announcement: string(0, 500, positionCursor++),
      hideBannedContent: { type: 'boolean', position: positionCursor++ },
    },
    required: ['$createdAt', 'key', 'name'],
    additionalProperties: false,
    indices: [
      { name: 'byKey', properties: [{ key: 'asc' }], unique: true },
    ],
  };
}

function categoryType() {
  let positionCursor = 0;
  return {
    type: 'object',
    canBeDeleted: false,
    creationRestrictionMode: 1,
    documentsMutable: true,
    properties: {
      slug: slug(positionCursor++),
      title: title(positionCursor++),
      description: string(0, 300, positionCursor++),
      sort: int(0, 65535, positionCursor++),
    },
    required: ['$createdAt', 'slug', 'title', 'sort'],
    additionalProperties: false,
    indices: [
      { name: 'bySlug', properties: [{ slug: 'asc' }], unique: true },
      { name: 'bySort', properties: [{ sort: 'asc' }] },
    ],
  };
}

function forumType() {
  let positionCursor = 0;
  return {
    type: 'object',
    canBeDeleted: false,
    creationRestrictionMode: 1,
    documentsMutable: true,
    immutable: ['categoryId'],
    properties: {
      categoryId: { ...CATEGORY_ID, position: positionCursor++ },
      slug: slug(positionCursor++),
      title: title(positionCursor++),
      description: string(0, 500, positionCursor++),
      sort: int(0, 65535, positionCursor++),
      archived: { type: 'boolean', position: positionCursor++ },
    },
    required: ['$createdAt', 'categoryId', 'slug', 'title', 'sort'],
    additionalProperties: false,
    indices: [
      { name: 'bySlug', properties: [{ slug: 'asc' }], unique: true },
      { name: 'byCategory', properties: [{ categoryId: 'asc' }, { sort: 'asc' }] },
    ],
  };
}

function teamMemberType() {
  let positionCursor = 0;
  return {
    type: 'object',
    canBeDeleted: false,
    creationRestrictionMode: 1,
    documentsMutable: true,
    properties: {
      memberId: { type: 'identifier', position: positionCursor++ },
      role: string(1, 40, positionCursor++),
      sort: int(0, 65535, positionCursor++),
    },
    required: ['$createdAt', 'memberId', 'role', 'sort'],
    additionalProperties: false,
    indices: [
      { name: 'byMember', properties: [{ memberId: 'asc' }], unique: true },
    ],
  };
}

function threadType(mode) {
  let positionCursor = 0;
  const moderated = mode !== 'none';
  const props = {
    forumId: { ...FORUM_ID, position: positionCursor++ },
    title: string(3, 150, positionCursor++),
    tags: {
      type: 'array',
      minItems: 0,
      maxItems: 5,
      uniqueItems: true,
      items: { type: 'string', minLength: 1, maxLength: 32, pattern: '^[a-z0-9-]{1,32}$' },
      position: positionCursor++,
    },
  };
  if (moderated) {
    props.sticky = { type: 'boolean', position: positionCursor++ };
    props.lockedAt = int(0, undefined, positionCursor++);
    props.modState = int(1, 3, positionCursor++);
    props.modNote = string(0, 200, positionCursor++);
  }
  const indices = [
    { name: 'byForum', properties: [{ forumId: 'asc' }, { $createdAt: 'asc' }], rangeCountable: true },
    { name: 'byAuthor', properties: [{ $ownerId: 'asc' }, { $createdAt: 'asc' }], rangeCountable: true },
    { name: 'recent', properties: [{ $createdAt: 'asc' }] },
    { name: 'byUpdated', properties: [{ $updatedAt: 'asc' }] },
    { name: 'byTag', properties: [{ tags: 'asc' }, { $createdAt: 'asc' }] },
  ];
  if (moderated) {
    indices.push({ name: 'byForumSticky', properties: [{ forumId: 'asc' }, { sticky: 'asc' }], skipIfAbsent: ['sticky'] });
    indices.push({ name: 'moderated', properties: [{ $moderatedAt: 'asc' }], nullSearchable: false });
  }
  return {
    type: 'object',
    canBeDeleted: false,
    documentsMutable: true,
    documentsCountable: true,
    immutable: ['forumId'],
    ...(moderated
      ? { moderatorAbilities: { delete: true, deleteKeepsFields: ['forumId'], changeFields: ['sticky', 'lockedAt', 'modState', 'modNote'] } }
      : {}),
    properties: props,
    required: FORUM_REF_REQUIRED,
    additionalProperties: false,
    indices,
  };
}

function postType(mode) {
  let positionCursor = 0;
  const moderated = mode !== 'none';
  const props = {
    threadId: { ...THREAD_ID, position: positionCursor++ },
    forumId: { ...FORUM_ID, position: positionCursor++ },
    body: string(1, 4000, positionCursor++, { maxBytes: 5120 }),
    replyToId: { type: 'identifier', position: positionCursor++ },
  };
  if (moderated) {
    props.modState = int(1, 3, positionCursor++);
    props.modNote = string(0, 200, positionCursor++);
  }
  const indices = [
    { name: 'byThread', properties: [{ threadId: 'asc' }, { $createdAt: 'asc' }], rangeCountable: true },
    { name: 'byForum', properties: [{ forumId: 'asc' }, { $createdAt: 'asc' }], rangeCountable: true },
    { name: 'byAuthor', properties: [{ $ownerId: 'asc' }, { $createdAt: 'asc' }], rangeCountable: true },
    { name: 'recent', properties: [{ $createdAt: 'asc' }] },
    { name: 'byUpdated', properties: [{ $updatedAt: 'asc' }] },
  ];
  if (moderated) {
    indices.push({ name: 'moderated', properties: [{ $moderatedAt: 'asc' }], nullSearchable: false });
  }
  return {
    type: 'object',
    canBeDeleted: true,
    documentsMutable: true,
    documentsCountable: true,
    immutable: ['threadId', 'forumId'],
    ...(moderated
      ? { moderatorAbilities: { delete: true, deleteKeepsFields: ['threadId', 'forumId'], changeFields: ['modState', 'modNote'] } }
      : {}),
    properties: props,
    required: ['$createdAt', '$updatedAt', 'threadId', 'forumId', 'body'],
    additionalProperties: false,
    indices,
  };
}

function reactionType() {
  let positionCursor = 0;
  return {
    type: 'object',
    canBeDeleted: true,
    documentsMutable: false,
    documentsCountable: true,
    properties: {
      postId: {
        type: 'identifier',
        refersTo: {
          type: 'deletableDocument',
          documentType: 'post',
          where: { $ownerId: 'postOwnerId', threadId: 'threadId' },
        },
        position: positionCursor++,
      },
      postOwnerId: { type: 'identifier', position: positionCursor++ },
      threadId: { type: 'identifier', position: positionCursor++ },
      kind: int(1, 8, positionCursor++),
    },
    required: ['$createdAt', 'postId', 'postOwnerId', 'threadId', 'kind'],
    additionalProperties: false,
    indices: [
      { name: 'byPostOwner', properties: [{ postId: 'asc' }, { $ownerId: 'asc' }], unique: true },
      { name: 'byPostKind', properties: [{ postId: 'asc' }, { kind: 'asc' }], countable: true },
      { name: 'byRecipient', properties: [{ postOwnerId: 'asc' }], countable: true },
      { name: 'byThreadOwner', properties: [{ threadId: 'asc' }, { $ownerId: 'asc' }] },
    ],
  };
}

function reportType(mode) {
  let positionCursor = 0;
  const moderated = mode !== 'none';
  const props = {
    postId: { type: 'identifier', refersTo: { type: 'deletableDocument', documentType: 'post' }, position: positionCursor++ },
    threadId: { type: 'identifier', position: positionCursor++ },
    reason: int(1, 8, positionCursor++),
    note: string(0, 280, positionCursor++),
  };
  const required = ['$createdAt', 'postId', 'threadId', 'reason'];
  if (moderated) {
    props.status = int(1, 3, positionCursor++);
    props.resolution = string(0, 200, positionCursor++);
  }
  return {
    type: 'object',
    canBeDeleted: true,
    documentsMutable: false,
    ...(moderated ? { moderatorAbilities: { delete: true, changeFields: ['status', 'resolution'] } } : {}),
    properties: props,
    required,
    additionalProperties: false,
    indices: [
      { name: 'byPostReporter', properties: [{ postId: 'asc' }, { $ownerId: 'asc' }], unique: true },
      { name: 'recent', properties: [{ $createdAt: 'asc' }] },
    ],
  };
}

function profileType(mode) {
  let positionCursor = 0;
  const moderated = mode !== 'none';
  const props = {
    displayName: string(1, 40, positionCursor++),
    bio: string(0, 1000, positionCursor++),
    signature: string(0, 300, positionCursor++),
    avatarUrl: string(0, 300, positionCursor++, { pattern: '^https://[^\\s]+$' }),
    website: string(0, 200, positionCursor++),
  };
  if (moderated) {
    props.customTitle = string(0, 40, positionCursor++);
    props.modState = int(1, 3, positionCursor++);
  }
  return {
    type: 'object',
    canBeDeleted: true,
    documentsMutable: true,
    documentsCountable: true,
    ...(moderated ? { moderatorAbilities: { delete: true, changeFields: ['customTitle', 'modState'] } } : {}),
    properties: props,
    required: ['$createdAt', '$updatedAt', 'displayName'],
    additionalProperties: false,
    indices: [
      { name: 'byOwner', properties: [{ $ownerId: 'asc' }], unique: true },
    ],
  };
}

// ---- assembly ---------------------------------------------------------------

function moderatorsFor(mode, deployer) {
  if (mode === 'team') {
    return { $type: 'appointedModerators', identities: deployer ? [deployer] : [] };
  }
  if (mode === 'network') {
    return {
      $type: 'elected',
      seatContestable: false,
      maxAddedModerators: 0,
      ownerProtected: true,
      moderatedDocumentTypes: {
        thread: ['deleteDocuments', 'changeDocumentFields'],
        post: ['deleteDocuments', 'changeDocumentFields'],
        report: ['deleteDocuments', 'changeDocumentFields'],
        profile: ['deleteDocuments', 'changeDocumentFields'],
      },
      interim: { $type: 'appointedModerators', identities: deployer ? [deployer] : [] },
    };
  }
  return null;
}

export function buildContract({ moderation = 'team', deployer = null }) {
  if (!MODERATION_MODES.includes(moderation)) {
    throw new Error(`--moderation must be one of ${MODERATION_MODES.join('|')}`);
  }
  const moderated = moderation !== 'none';

  const documentSchemas = {
    forumSettings: forumSettingsType(),
    category: categoryType(),
    forum: forumType(),
    teamMember: teamMemberType(),
    thread: threadType(moderation),
    post: postType(moderation),
    reaction: reactionType(),
    report: reportType(moderation),
    profile: profileType(moderation),
  };

  const config = {
    $formatVersion: '2',
    canBeDeleted: false,
    readonly: false,
    keepsHistory: false,
    documentsKeepHistoryContractDefault: false,
    documentsMutableContractDefault: true,
    documentsCanBeDeletedContractDefault: true,
    sizedIntegerTypes: true,
  };
  if (moderated) {
    config.moderation = {
      banlist: true,
      suspensions: true,
      warnings: true,
      moderators: moderatorsFor(moderation, deployer),
    };
  }

  return {
    $formatVersion: '1',
    id: 'PV5ERAp8YpWhfpG2K8kEYoCEshKM2VgkY4UQyUQCUMCc',
    ownerId: 'PV5ERAp8YpWhfpG2K8kEYoCEshKM2VgkY4UQyUQCUMCc',
    version: 1,
    description: 'dForum: a forum on Dash Platform, owned and moderated by the deployer team.',
    config,
    documentSchemas,
    keywords: ['forum', 'community', 'dash-platform'],
  };
}

// ---- CLI -------------------------------------------------------------------

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  let mode = 'team';
  let deployer = null;
  let outDir = join(REPO_ROOT, 'contracts', 'generated');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--moderation') mode = args[++i];
    else if (args[i] === '--deployer') deployer = args[++i];
    else if (args[i] === '--out') outDir = args[++i];
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log('Usage: node contracts/build.mjs --moderation none|team|network [--deployer <identityId>] [--out <dir>]');
      process.exit(0);
    } else throw new Error(`unknown argument: ${args[i]}`);
  }
  const contract = buildContract({ moderation: mode, deployer });
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `dforum.${mode}.json`);
  writeFileSync(outFile, JSON.stringify(contract, null, 2) + '\n');
  console.log(`wrote ${outFile}`);
}
