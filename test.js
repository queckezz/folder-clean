
const {
  markEmptyFoldersAsDeletable,
  analyzeFolderRecursive,
  actionsToObject,
  executeActions,
  analyzeFolder,
  analyzeItem,
  actionTypes,
  itemTypes
} = require('./')

const { ephemeralFsFromObject } = require('fs-from-object')
const { stat } = require('mz/fs')
const { join } = require('path')
const test = require('ava')

const oldFile = {
  name: 'old.txt',
  mtime: new Date('01/13/2016')
}

const newFile = {
  name: 'new.txt',
  mtime: new Date('01/13/2017')
}

test('retains a single file when date is not older than the max age', (t) => {
  return ephemeralFsFromObject([newFile], async (path) => {
    const file = join(path, 'new.txt')
    const report = await analyzeItem(file, new Date('01/13/2017'), 90)
    t.is(report.itemType, itemTypes.FILE)
    t.is(report.path, file)
    t.is(report.actionType, actionTypes.RETAIN)
  })
})

test('deletes a single file when date is older than the max age', (t) => {
  return ephemeralFsFromObject([oldFile], async (path) => {
    const file = join(path, 'old.txt')
    const report = await analyzeItem(file, new Date('01/13/2017'), 90)
    t.is(report.itemType, itemTypes.FILE)
    t.is(report.path, file)
    t.is(report.actionType, actionTypes.DELETE)
  })
})

test('analyzes a single folder', (t) => {
  return ephemeralFsFromObject([{
    name: 'folder',
    contents: []
  }], async (path) => {
    const folder = join(path, 'folder')
    const report = await analyzeItem(folder)
    t.is(report.itemType, itemTypes.EMPTY_DIR)
    t.is(report.path, folder)
    t.is(report.actionType, actionTypes.RETAIN)
  })
})

test('analyzes folder contents', (t) => {
  return ephemeralFsFromObject([oldFile, newFile], async (path) => {
    const report = await analyzeFolder(path, new Date('01/13/2017'), 90)
    t.is(findItemAction(report, path, newFile.name).actionType, actionTypes.RETAIN)
    t.is(findItemAction(report, path, oldFile.name).actionType, actionTypes.DELETE)
  })
})

test('recursively analyzes a folder', (t) => {
  return ephemeralFsFromObject([
    oldFile,
    { name: 'folder', contents: [newFile] }
  ], async (path) => {
    const report = await analyzeFolderRecursive(path, new Date('01/13/2017'), 90)
    t.is(findItemAction(report, path, oldFile.name).actionType, actionTypes.DELETE)

    const folder = findItemAction(report, path, 'folder')
    t.is(folder.actionType, actionTypes.RETAIN)
    t.is(folder.actions.length, 1)
  })
})

test('recursively analyzes a folder and removes empty ones', (t) => {
  return ephemeralFsFromObject([
    { name: 'folder', contents: [oldFile] }
  ], async (path) => {
    const report = markEmptyFoldersAsDeletable(
      await analyzeFolderRecursive(path, new Date('01/13/2017'), 90)
    )

    t.is(report[0].actionType, actionTypes.DELETE)
    t.is(report[0].actions[0].actionType, actionTypes.DELETE)
  })
})

test('keeps a folder with a new file, though empty folders can be deleted', (t) => {
  return ephemeralFsFromObject([
    { name: 'folder', contents: [newFile] }
  ], async (path) => {
    const report = markEmptyFoldersAsDeletable(
      await analyzeFolderRecursive(path, new Date('01/13/2017'), 90)
    )

    t.is(report[0].actionType, actionTypes.RETAIN)
    t.is(report[0].actions[0].actionType, actionTypes.RETAIN)
  })
})

test('converts array of actions to an object', (t) => {
  return ephemeralFsFromObject([oldFile, newFile], async (path) => {
    const report = actionsToObject(
      await analyzeFolder(path, new Date('01/13/2017'), 90)
    )

    t.truthy(report.delete)
    t.truthy(report.retain)
    t.is(report.delete.length, 1)
    t.is(report.retain.length, 1)
    t.is(report.delete[0].actionType, actionTypes.DELETE)
    t.is(report.retain[0].actionType, actionTypes.RETAIN)
  })
})

test('executes actions', (t) => {
  return ephemeralFsFromObject([
    { name: 'empty-folder', contents: [] },
    { name: 'sub-folder', contents: [oldFile, newFile] },
    oldFile,
    newFile
  ], async (path) => {
    const actions = markEmptyFoldersAsDeletable(
      await analyzeFolderRecursive(path, new Date('01/13/2017'), 90)
    )

    await executeActions(actions)

    await Promise.all([
      shouldntExist(t, path, 'old.txt'),
      shouldntExist(t, path, 'sub-folder/old.txt'),
      shouldntExist(t, path, 'empty-folder'),

      shouldExist(t, path, 'new.txt'),
      shouldExist(t, path, 'sub-folder/new.txt')
    ])
  })
})

test('executes actions just one level deep', (t) => {
  return ephemeralFsFromObject([
    { name: 'empty-folder', contents: [] },
    { name: 'sub-folder', contents: [oldFile, newFile] },
    oldFile,
    newFile
  ], async (path) => {
    const actions = await analyzeFolder(path, new Date('01/13/2017'), 90)

    await executeActions(actions)

    await Promise.all([
      shouldntExist(t, path, 'old.txt'),

      shouldExist(t, path, 'new.txt'),
      shouldExist(t, path, 'empty-folder'),
      shouldExist(t, path, 'sub-folder/old.txt'),
      shouldExist(t, path, 'sub-folder/new.txt')
    ])
  })
})

function findItemAction (actions, path, name) {
  return actions.find((action) => action.path === join(path, name))
}

function shouldExist (t, path, item) {
  return stat(join(path, item))
    .then(() => t.pass())
    .catch(() => t.fail(`old item ${item} doesn't exist`))
}

function shouldntExist (t, path, item) {
  return stat(join(path, item))
    .then(() => t.fail(`old item ${item} still exists`))
    .catch(() => t.pass())
}
