
const { rmdir, unlink, readdir, stat } = require('mz/fs')
const { differenceInDays } = require('date-fns')
const { dissoc, groupBy } = require('ramda')
const { join } = require('path')

const actionTypes = {
  DELETE: Symbol('DELETE'),
  RETAIN: Symbol('RETAIN'),
  BUSY: Symbol('BUSY')
}

const itemTypes = {
  EMPTY_DIR: Symbol('EMPTY_DIR'),
  FILE: Symbol('FILE'),
  DIR: Symbol('DIR')
}

module.exports = {
  markEmptyFoldersAsDeletable,
  analyzeFolderRecursive,
  actionsToObject,
  executeActions,
  analyzeFolder,
  analyzeItem,
  actionTypes,
  itemTypes
}

async function analyzeFolderRecursive (path, deleteAt, maxAge) {
  const actions = await analyzeFolder(path, deleteAt, maxAge)
  return Promise.all(actions.map(async (action) => {
    if (action.itemType !== itemTypes.DIR) {
      return action
    }

    const dirActions = await analyzeFolder(action.path, deleteAt, maxAge)
    return DirAction(Object.assign({}, action, { actions: dirActions }))
  }))
}

function markEmptyFoldersAsDeletable (actions) {
  return actions.map((action) => {
    if (action.itemType === itemTypes.FILE) {
      return action
    }

    return isFolderDeletable(action)
      ? DirAction(Object.assign({}, action, { actionType: actionTypes.DELETE }))
      : action
  })
}

function isFolderDeletable (action) {
  return isEmptyFolder(action) || hasFolderDeletableFiles(action)
}

function hasFolderDeletableFiles ({ actions }) {
  return actions.every(
    ({ actionType }) => actionType === actionTypes.DELETE)
}

function isEmptyFolder ({ itemType }) {
  return itemType === itemTypes.EMPTY_DIR
}

async function analyzeFolder (path, deleteAt, maxAge) {
  const directoryItems = await readdir(path)

  const actions = await Promise.all(
    directoryItems.map(
      (item) => analyzeItem(join(path, item), deleteAt, maxAge))
  )

  return actions
}

async function analyzeItem (fullPath, deleteDate, maxAge) {
  const stats = await stat(fullPath)

  if (stats.isFile()) {
    return maxAge <= differenceInDays(deleteDate, stats.mtime)
      ? FileAction(actionTypes.DELETE, stats, fullPath)
      : FileAction(actionTypes.RETAIN, stats, fullPath)
  } else {
    const directoryItems = await readdir(fullPath)

    return DirAction({
      actionType: actionTypes.RETAIN,
      isEmpty: directoryItems.length === 0,
      path: fullPath,
      actions: [],
      stats
    })
  }
}

async function executeActions (actions) {
  for (let action of actions) {
    if (action.itemType === itemTypes.DIR) {
      await executeActions(action.actions)
    }

    if (action.actionType === actionTypes.DELETE) {
      action.itemType === itemTypes.DIR
        ? await rmdir(action.path)
        : await unlink(action.path)
    }
  }
}

function actionsToObject (actions) {
  return groupBy(
    ({ actionType }) => {
      switch (actionType) {
        case actionTypes.DELETE:
          return 'delete'
        case actionTypes.RETAIN:
          return 'retain'
        case actionTypes.BUSY:
          return 'busy'
      }
    },
    flattenActions(actions)
  )
}

function flattenActions (actions) {
  return actions.reduce((acc, action) => {
    if (action.itemType === itemTypes.DIR) {
      return acc
        .concat(action.actions)
        .concat([dissoc('actions', action)])
    } else {
      return acc.concat([action])
    }
  }, [])
}

function FileAction (actionType, stats, path) {
  return { itemType: itemTypes.FILE, actionType, path }
}

function DirAction ({ actionType, isEmpty, path, actions, stats }) {
  return {
    itemType: isEmpty
      ? itemTypes.EMPTY_DIR
      : itemTypes.DIR,

    actionType,
    path,
    actions
  }
}
