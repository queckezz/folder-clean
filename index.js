
const { rmdir, unlink, readdir, stat } = require('mz/fs')
const { dissoc, merge, groupBy } = require('ramda')
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
  getFolderActions,
  flattenActions,
  executeActions,
  actionTypes,
  sortByType,
  itemTypes,
  clean
}

async function clean (path, _config) {
  const config = merge({
    deleteEmptyFolders: false,
    deleteAt: new Date(),
    recursive: false,
    maxAge: 90
  }, _config)

  const actions = await getFolderActions(path, config)
  await executeActions(actions)
  return sortByType(actions)
}

async function getFolderActions (
  path,
  { deleteAt, maxAge, recursive, deleteEmptyFolders }
) {
  const directoryContents = await readdir(path)

  const actions = await Promise.all(directoryContents.map(async (item) => {
    const action = await getItemAction(join(path, item), deleteAt, maxAge)
    if (recursive && action.itemType === itemTypes.DIR) {
      const dirActions = await getFolderActions(
        action.path,
        { deleteAt, maxAge, recursive }
      )

      return isFolderDeletable(dirActions, deleteEmptyFolders)
        ? DirAction(actionTypes.DELETE, action.stats, action.path, dirActions)
        : DirAction(actionTypes.RETAIN, action.stats, action.path, dirActions)
    }

    return action
  }))

  return actions
}

async function getItemAction (fullPath, deleteDate, maxAge) {
  const stats = await stat(fullPath)

  if (stats.isFile()) {
    return maxAge <= differenceInDays(deleteDate, stats.mtime)
      ? FileAction(actionTypes.DELETE, stats, fullPath)
      : FileAction(actionTypes.RETAIN, stats, fullPath)
  } else {
    return DirAction(null, stats, fullPath)
  }
}

function isFolderDeletable (actions, deleteEmptyFolders) {
  const isEmpty = actions.length === 0

  const hasAllDeletableFiles = actions
    .every(({ actionType }) => actionType === actionTypes.DELETE)

  if (!deleteEmptyFolders) {
    return false
  }

  return isEmpty || hasAllDeletableFiles
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

function sortByType (actions) {
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
