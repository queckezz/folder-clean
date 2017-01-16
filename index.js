
const { rmdir, unlink, readdir, stat } = require('mz/fs')
const { dissoc, groupBy } = require('ramda')
const { differenceInDays } = require('date-fns')
const { join } = require('path')

const actionTypes = {
  DELETE: Symbol('DELETE'),
  RETAIN: Symbol('RETAIN'),
  BUSY: Symbol('BUSY')
}

const itemTypes = {
  DIR: Symbol('DIR'),
  FILE: Symbol('FILE')
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
    return DirAction(actionTypes.RETAIN, action.stats, action.path, dirActions)
  }))
}

function markEmptyFoldersAsDeletable (actions) {
  return actions.map((action) => {
    if (action.itemType !== itemTypes.DIR) {
      return action
    }

    return isFolderDeletable(action.actions)
      ? DirAction(actionTypes.DELETE, action.stats, action.path, action.actions)
      : action
  })
}

function isFolderDeletable (actions) {
  const isEmpty = actions.length === 0

  const hasAllDeletableFiles = actions
    .every(({ actionType }) => actionType === actionTypes.DELETE)

  return isEmpty || hasAllDeletableFiles
}

async function analyzeFolder (path, deleteAt, maxAge) {
  const directoryContents = await readdir(path)

  const actions = await Promise.all(
    directoryContents.map(
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
    return DirAction(null, stats, fullPath)
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
  return {
    itemType: itemTypes.FILE,
    actionType,
    path
  }
}

function DirAction (actionType, stats, path, actions) {
  return {
    itemType: itemTypes.DIR,
    actionType,
    path,
    actions
  }
}
