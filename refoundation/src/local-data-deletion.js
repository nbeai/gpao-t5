import { homedir } from 'node:os';
import { parse, resolve } from 'node:path';
import { rm } from 'node:fs/promises';

function scopedPath(value, label) {
  const target = resolve(String(value ?? ''));
  const root = parse(target).root;
  if (!value || target === root || target === resolve(homedir())) {
    throw new Error(`${label} is not a scoped T5 path`);
  }
  return target;
}

/**
 * Remove only local state owned by T5. User workspaces, separately downloaded
 * backups, provider-side copies, and credentials owned by third-party CLIs are
 * deliberately outside this inventory.
 */
export async function deleteT5OwnedLocalData({
  stateDir,
  connectionFile,
  modelConnections,
  messengerCredentialStore,
  workspaceConnectionServices = [],
  messengerProviders = ['telegram'],
} = {}) {
  const stateRoot = scopedPath(stateDir, 'T5 state root');
  const modelFile = scopedPath(connectionFile, 'T5 model connection file');
  if (!modelConnections?.list || !modelConnections?.disconnect) {
    throw new TypeError('T5 model connection owner is required');
  }
  if (!messengerCredentialStore?.clear) {
    throw new TypeError('T5 messenger credential owner is required');
  }
  const services = workspaceConnectionServices.filter(Boolean);
  if (services.some((service) => typeof service.disconnect !== 'function')) {
    throw new TypeError('T5 workspace connection owner is invalid');
  }

  const inventory = {
    workspaceConnections: services.map((service) => String(service.id ?? service.label ?? 'connection')),
    modelConnections: (await modelConnections.list()).map((item) => String(item.id)),
    messengerProviders: [...new Set(messengerProviders.map(String))],
    stateRoot,
    modelFile,
  };

  // Credential owners clear their exact secret before their canonical metadata
  // is removed. If any owner fails, keep both filesystem roots so a later
  // explicit retry can inspect and finish the remaining deletion obligation.
  for (const service of services) await service.disconnect();
  for (const provider of inventory.messengerProviders) await messengerCredentialStore.clear(provider);
  for (const id of inventory.modelConnections) await modelConnections.disconnect(id);

  await rm(modelFile, { force: true });
  await rm(stateRoot, { recursive: true, force: true });
  return Object.freeze({
    schema: 't5.local-data-deletion-receipt.v1',
    state: 'deleted',
    workspaceConnectionsCleared: inventory.workspaceConnections.length,
    modelConnectionsCleared: inventory.modelConnections.length,
    messengerCredentialsCleared: inventory.messengerProviders.length,
    userWorkspaceDeleted: false,
    separateBackupFilesDeleted: false,
    externalServiceCopiesDeleted: false,
  });
}
